-- AI 智能客服工作台 v4 增量迁移（幂等，在 Supabase SQL Editor 整段执行一次）
-- 新增：claim_calcs 理赔测算记录 / video_reviews 视频复核记录

CREATE TABLE IF NOT EXISTS claim_calcs (
  id BIGSERIAL PRIMARY KEY,
  ticket_id INT,
  ticket_no VARCHAR(60),
  scenario VARCHAR(60),          -- 问题组（效期质量/识别错误多扣/不文明购物…）
  inputs_json TEXT,              -- 输入快照
  result_json TEXT,              -- 结果快照（建议区间/起谈点/成交点）
  adopted BOOLEAN DEFAULT false, -- 是否已采纳写入工单跟进（已采纳禁删）
  created_by VARCHAR(80),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_reviews (
  id BIGSERIAL PRIMARY KEY,
  order_no VARCHAR(60),
  shelf_code VARCHAR(60),
  reviewer VARCHAR(80),
  verdict VARCHAR(20),           -- 正常 / 异常 / 存疑
  disputed_items VARCHAR(300),   -- 争议商品/事项
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['claim_calcs','video_reviews']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'wb_all_' || t) THEN
      EXECUTE format('CREATE POLICY wb_all_%I ON %I FOR ALL USING (true) WITH CHECK (true)', t, t);
    END IF;
  END LOOP;
END $$;

-- 演示种子（重复执行会重置）
DELETE FROM video_reviews;
INSERT INTO video_reviews (order_no, shelf_code, reviewer, verdict, disputed_items, note) VALUES
  ('DD20261019002', 'A359808', '小何（二线工单）', '异常', '未扫码拿取×1', '同一人拿取2件仅扫码1件，与客诉"只拿了一个"部分吻合，按差额退'),
  ('DD20261018006', 'A360105', '小何（二线工单）', '存疑', '开门未出货', '视频丢帧3秒，无法确认出货，转人工复核并优先退款');

DELETE FROM claim_calcs;
INSERT INTO claim_calcs (ticket_id, ticket_no, scenario, inputs_json, result_json, adopted, created_by) VALUES
  (3, 'GD20261019003', '效期质量', '{"单价":5.0,"数量":1,"诉求":150,"是否食用":"否","凭证":"有订单+实物"}', '{"建议区间":[15,50],"起谈点":15,"成交点":50,"依据":"规则侧<200二线；数据侧P50=106.5"}', true, '小何（二线工单）');

SELECT setval(pg_get_serial_sequence('claim_calcs', 'id'), COALESCE((SELECT MAX(id) FROM claim_calcs), 1));
SELECT setval(pg_get_serial_sequence('video_reviews', 'id'), COALESCE((SELECT MAX(id) FROM video_reviews), 1));

INSERT INTO seed_meta (k, v) VALUES ('seed_version', 'kfwt-demo-4') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
