-- AI 智能客服工作台 v2 增量迁移（幂等，在 Supabase SQL Editor 整段执行一次）
-- 新增：supervisions 督办任务表（AI 分析后人工确认创建，真实落库）

CREATE TABLE IF NOT EXISTS supervisions (
  id BIGSERIAL PRIMARY KEY,
  ticket_no VARCHAR(60),            -- 关联工单号
  customer_id INT,
  customer_name VARCHAR(120),
  reason TEXT,                      -- 督办原因（AI 分析结论）
  dept VARCHAR(60),                 -- 责任部门
  status VARCHAR(20) DEFAULT '待跟进', -- 待跟进 / 处理中 / 已闭环
  next_check VARCHAR(30),           -- 下次检查时间
  ops_log TEXT,                     -- 操作记录（JSON 摘要）
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS 放行（与其他表一致，权限由应用层控制）
DO $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', 'supervisions');
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supervisions' AND policyname = 'wb_all_supervisions') THEN
    EXECUTE format('CREATE POLICY wb_all_%I ON %I FOR ALL USING (true) WITH CHECK (true)', 'supervisions', 'supervisions');
  END IF;
END $$;

-- 演示种子（重复执行会重置演示督办）
DELETE FROM supervisions;
INSERT INTO supervisions (ticket_no, customer_id, customer_name, reason, dept, status, next_check, ops_log) VALUES
  ('GD20261020001', 1, '望京鲜生便利（演示）', 'SLA 临超时：紧急工单 4 小时响应期内未见受理，客户二次来电催促', '设备运维', '待跟进', '2026-10-21 10:00', '[{"actor":"AI 分析","action":"识别 SLA 异常","time":"2026-10-20"}]'),
  ('GD20261018005', 1, '望京鲜生便利（演示）', '重复投诉风险：撤架类诉求挂起超 48 小时无有效跟进', '运营中心', '待跟进', '2026-10-22 10:00', '[{"actor":"AI 分析","action":"识别长时间无跟进","time":"2026-10-20"}]');

SELECT setval(pg_get_serial_sequence('supervisions', 'id'), COALESCE((SELECT MAX(id) FROM supervisions), 1));

INSERT INTO seed_meta (k, v) VALUES ('seed_version', 'kfwt-demo-2') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
