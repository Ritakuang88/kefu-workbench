// gen_seed.js —— 生成 migration.sql（建表 + RLS + 种子数据），node gen_seed.js > migration.sql
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const hashPw = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const esc = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : "'" + String(v).replace(/'/g, "''") + "'";

// —— 分类字典（取自原型 CATEGORIES） ——
const CAT_SRC = path.join(__dirname, '..', 'prototype', 'categories.js');
const CATEGORIES = eval('(' + fs.readFileSync(CAT_SRC, 'utf8').replace(/^const\s+CATEGORIES\s*=/, '') + ')');
const HOT = ['货架频繁断网', '缺货长期未补', '催补货未响应', '待结算金额核对', '退款退货申请', '商品过期', '申请撤架', '打款进度查询'];

// —— 表结构（与 server.js TABLES 白名单严格一致） ——
const SCHEMAS = {
  users: `id BIGSERIAL PRIMARY KEY, username VARCHAR(80) UNIQUE, password_hash VARCHAR(255), nick VARCHAR(120), role VARCHAR(30) DEFAULT 'member', status VARCHAR(20) DEFAULT 'approved', permissions TEXT DEFAULT '[]', last_login_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()`,
  seed_meta: `k VARCHAR(80) PRIMARY KEY, v TEXT`,
  tickets: `id BIGSERIAL PRIMARY KEY, ticket_no VARCHAR(60) UNIQUE, customer_id INT, customer_name VARCHAR(120), region VARCHAR(60), channel VARCHAR(30), biz_type VARCHAR(10), cat_path VARCHAR(300), cat_code VARCHAR(40), shelf_id VARCHAR(60), shelf_code VARCHAR(60), risk VARCHAR(30), urgency VARCHAR(20), escalate BOOLEAN DEFAULT false, role VARCHAR(30), demand TEXT, content TEXT, visible_content TEXT, status VARCHAR(20) DEFAULT '待受理', handler VARCHAR(80), creator VARCHAR(80), sla_hours NUMERIC DEFAULT 24, created_at TIMESTAMPTZ DEFAULT now()`,
  ticket_events: `id BIGSERIAL PRIMARY KEY, ticket_id INT, actor VARCHAR(80), action VARCHAR(60), detail TEXT, created_at TIMESTAMPTZ DEFAULT now()`,
  closures: `id BIGSERIAL PRIMARY KEY, ticket_id INT, product_codes VARCHAR(200), product_name VARCHAR(200), problem VARCHAR(60), visible_issue BOOLEAN, prod_date VARCHAR(20), decider VARCHAR(60), refund_flag VARCHAR(20), refuse_claim BOOLEAN, demand_amount NUMERIC(10,2), refund_amount NUMERIC(10,2), pay_amount NUMERIC(10,2), energy_points NUMERIC(10,2), coupon_gift VARCHAR(60), water_gift VARCHAR(60), supplier_refund NUMERIC(10,2), note TEXT, updated_by VARCHAR(80), created_at TIMESTAMPTZ DEFAULT now()`,
  customers: `id BIGSERIAL PRIMARY KEY, name VARCHAR(120), level VARCHAR(10), region VARCHAR(60), phone VARCHAR(20), kp VARCHAR(60), wecom BOOLEAN DEFAULT false, identity VARCHAR(60), welfare BOOLEAN DEFAULT false, activated_at VARCHAR(20), blacklist BOOLEAN DEFAULT false, quality BOOLEAN DEFAULT false, tags TEXT DEFAULT '[]', spend_90d NUMERIC(12,2) DEFAULT 0, orders_90d INT DEFAULT 0, after_sales_90d INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now()`,
  categories: `id BIGSERIAL PRIMARY KEY, path VARCHAR(300) UNIQUE, code VARCHAR(40), hot BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now()`,
  shelves: `id BIGSERIAL PRIMARY KEY, customer_id INT, code VARCHAR(60), shelf_id VARCHAR(60), name VARCHAR(120), grade VARCHAR(4), level VARCHAR(10), status VARCHAR(20), online BOOLEAN, swap BOOLEAN DEFAULT false, swap_no VARCHAR(60), owner_name VARCHAR(60), owner_phone VARCHAR(20), created_at TIMESTAMPTZ DEFAULT now()`,
  devices: `id BIGSERIAL PRIMARY KEY, customer_id INT, code VARCHAR(60), point_id VARCHAR(60), point_name VARCHAR(120), online BOOLEAN, offline_7d INT DEFAULT 0, offline_30d INT DEFAULT 0, avg_offline_min INT DEFAULT 0, repair_no VARCHAR(60), withdraw BOOLEAN DEFAULT false, returned BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now()`,
  contracts: `id BIGSERIAL PRIMARY KEY, customer_id INT, name VARCHAR(200), contract_no VARCHAR(60), seal_status VARCHAR(20), party VARCHAR(200), sign_type VARCHAR(60), sealed_at VARCHAR(30), term_end VARCHAR(20), days_left INT, points INT, is_current BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()`,
  settlements: `id BIGSERIAL PRIMARY KEY, customer_id INT, point_id VARCHAR(60), code VARCHAR(60), point_name VARCHAR(120), supplier_code VARCHAR(60), amount NUMERIC(12,2), oldest_period VARCHAR(20), status VARCHAR(20), created_at TIMESTAMPTZ DEFAULT now()`,
  trades: `id BIGSERIAL PRIMARY KEY, customer_id INT, order_no VARCHAR(60), trade_no VARCHAR(60), merchant_no VARCHAR(80), code VARCHAR(60), shelf_id VARCHAR(60), phone VARCHAR(20), amount NUMERIC(10,2), status VARCHAR(20), source VARCHAR(60), pay_type VARCHAR(20), refunds INT DEFAULT 0, open_time VARCHAR(30), created_time VARCHAR(30), created_at TIMESTAMPTZ DEFAULT now()`,
  replenishments: `id BIGSERIAL PRIMARY KEY, customer_id INT, code VARCHAR(60), point_name VARCHAR(120), replenish_no VARCHAR(60), on_shelf_time VARCHAR(30), amount NUMERIC(10,2), sku_count INT, status VARCHAR(20), created_at TIMESTAMPTZ DEFAULT now()`,
  wishes: `id BIGSERIAL PRIMARY KEY, customer_id INT, code VARCHAR(60), product VARCHAR(120), brand VARCHAR(60), fe_code VARCHAR(40), in_list BOOLEAN DEFAULT true, supply_status VARCHAR(30), report_count INT DEFAULT 0, reporter VARCHAR(60), reporter_phone VARCHAR(20), wish_type VARCHAR(20), qty INT, period INT, created_at TIMESTAMPTZ DEFAULT now()`,
  supervisions: `id BIGSERIAL PRIMARY KEY, ticket_no VARCHAR(60), customer_id INT, customer_name VARCHAR(120), reason TEXT, dept VARCHAR(60), status VARCHAR(20) DEFAULT '待跟进', next_check VARCHAR(30), ops_log TEXT, created_at TIMESTAMPTZ DEFAULT now()`,
};
const BIZ_TABLES = Object.keys(SCHEMAS); // 含 users/seed_meta，RLS 全放行

// —— 种子数据 ——
const now = () => new Date();
const hoursAgo = h => `now() - interval '${h} hours'`;

const USERS = [
  { id: 1, username: 'admin', password: 'Admin@2026', nick: '管理员（管理层）', role: 'admin', status: 'approved', permissions: '[]' },
  { id: 2, username: 'agent01', password: 'Agent@2026', nick: '小艾（一线客服）', role: 'agent', status: 'approved', permissions: '[]' },
  { id: 3, username: 'agent02', password: 'Agent@2026', nick: '小李（一线客服）', role: 'agent', status: 'approved', permissions: '["second"]' },
  { id: 4, username: 'handler01', password: 'Handler@2026', nick: '小何（二线工单）', role: 'handler', status: 'approved', permissions: '["front"]' },
];

const CUSTOMERS = [
  { id: 1, name: '望京鲜生便利（演示）', level: 'E级', region: '北京大区-朝阳', phone: '13812345678', kp: '王建军', wecom: true, identity: '企业客户', welfare: false, activated_at: '2024-03-15', blacklist: false, quality: true, tags: '["重点维护","账期敏感"]', spend_90d: 86520.50, orders_90d: 1240, after_sales_90d: 6 },
  { id: 2, name: '国贸白领驿站（演示）', level: 'B级', region: '北京大区-朝阳', phone: '13998765432', kp: '陈曦', wecom: true, identity: '企业客户', welfare: true, activated_at: '2024-11-02', blacklist: false, quality: false, tags: '["愿意转对公"]', spend_90d: 41230.00, orders_90d: 689, after_sales_90d: 2 },
  { id: 3, name: '联洋社区超市（演示）', level: 'C级', region: '上海大区-浦东', phone: '13655557777', kp: '周敏', wecom: false, identity: '个体客户', welfare: false, activated_at: '2025-06-18', blacklist: false, quality: false, tags: '[]', spend_90d: 9860.80, orders_90d: 210, after_sales_90d: 1 },
];

const CATEGORIES_SEED = CATEGORIES.map((c, i) => ({
  id: i + 1, path: c.path.join(' > '), code: 'C' + String(i + 1).padStart(3, '0'), hot: HOT.includes(c.path[2]),
}));

const SHELVES = [
  { id: 1, customer_id: 1, code: 'A359808', shelf_id: 'SH-359808', name: '望京SOHO-T3-1层大厅', grade: 'A', level: 'E级', status: '已激活', online: true, swap: false, swap_no: null, owner_name: '王建军', owner_phone: '13812345678' },
  { id: 2, customer_id: 1, code: 'A359812', shelf_id: 'SH-359812', name: '望京SOHO-T1-12层茶水间', grade: 'B', level: 'E级', status: '已激活', online: false, swap: true, swap_no: 'GD20260918001', owner_name: '王建军', owner_phone: '13812345678' },
  { id: 3, customer_id: 1, code: 'A360105', shelf_id: 'SH-360105', name: '望京花园东区-南门', grade: 'C', level: 'E级', status: '已激活', online: true, swap: false, swap_no: null, owner_name: '李芳', owner_phone: '13711112222' },
  { id: 4, customer_id: 2, code: 'B400231', shelf_id: 'SH-400231', name: '国贸写字楼B座-2层', grade: 'A', level: 'B级', status: '已激活', online: true, swap: false, swap_no: null, owner_name: '陈曦', owner_phone: '13998765432' },
  { id: 5, customer_id: 3, code: 'C772190', shelf_id: 'SH-772190', name: '联洋社区中心-1层', grade: 'C', level: 'C级', status: '未激活', online: false, swap: false, swap_no: null, owner_name: '周敏', owner_phone: '13655557777' },
];

const DEVICES = [
  { id: 1, customer_id: 1, code: 'A359808', point_id: 'P-359808', point_name: '望京SOHO-T3-1层大厅', online: true, offline_7d: 0, offline_30d: 1, avg_offline_min: 12, repair_no: null, withdraw: false, returned: false },
  { id: 2, customer_id: 1, code: 'A359812', point_id: 'P-359812', point_name: '望京SOHO-T1-12层茶水间', online: false, offline_7d: 3, offline_30d: 9, avg_offline_min: 146, repair_no: 'WX20260915003', withdraw: false, returned: false },
  { id: 3, customer_id: 1, code: 'A360105', point_id: 'P-360105', point_name: '望京花园东区-南门', online: true, offline_7d: 1, offline_30d: 2, avg_offline_min: 25, repair_no: null, withdraw: false, returned: false },
  { id: 4, customer_id: 2, code: 'B400231', point_id: 'P-400231', point_name: '国贸写字楼B座-2层', online: true, offline_7d: 0, offline_30d: 0, avg_offline_min: 0, repair_no: null, withdraw: false, returned: false },
  { id: 5, customer_id: 3, code: 'C772190', point_id: 'P-772190', point_name: '联洋社区中心-1层', online: false, offline_7d: 5, offline_30d: 11, avg_offline_min: 210, repair_no: 'WX20261008011', withdraw: true, returned: false },
];

const CONTRACTS = [
  { id: 1, customer_id: 1, name: '智能货柜点位合作服务合同（2026年度）', contract_no: 'HT2026-BJ-00812', seal_status: '已签章', party: '望京鲜生便利有限公司', sign_type: '法大大电子签', sealed_at: '2026-01-10 14:32', term_end: '2027-01-09', days_left: 81, points: 3, is_current: true },
  { id: 2, customer_id: 1, name: '智能货柜点位合作服务合同（2025年度）', contract_no: 'HT2025-BJ-00664', seal_status: '已到期', party: '望京鲜生便利有限公司', sign_type: '法大大电子签', sealed_at: '2025-01-08 10:05', term_end: '2026-01-07', days_left: 0, points: 3, is_current: false },
  { id: 3, customer_id: 2, name: '智能货柜点位合作服务合同（国贸）', contract_no: 'HT2026-BJ-00931', seal_status: '待签章', party: '国贸白领驿站科技有限公司', sign_type: '法大大电子签', sealed_at: null, term_end: '2027-03-31', days_left: 162, points: 1, is_current: true },
];

const SETTLEMENTS = [
  { id: 1, customer_id: 1, point_id: 'P-359808', code: 'A359808', point_name: '望京SOHO-T3-1层大厅', supplier_code: 'SUP-BJ-0217', amount: 18250.00, oldest_period: '2026-08', status: '未结算' },
  { id: 2, customer_id: 1, point_id: 'P-359812', code: 'A359812', point_name: '望京SOHO-T1-12层茶水间', supplier_code: 'SUP-BJ-0217', amount: 9530.50, oldest_period: '2026-09', status: '结算中' },
  { id: 3, customer_id: 1, point_id: 'P-360105', code: 'A360105', point_name: '望京花园东区-南门', supplier_code: 'SUP-BJ-0305', amount: 4218.30, oldest_period: '2026-09', status: '未结算' },
  { id: 4, customer_id: 2, point_id: 'P-400231', code: 'B400231', point_name: '国贸写字楼B座-2层', supplier_code: 'SUP-BJ-0512', amount: 7980.00, oldest_period: '2026-09', status: '未结算' },
];

const TRADES = [
  { id: 1, customer_id: 1, order_no: 'DD20261019001', trade_no: 'TR991020001', merchant_no: 'MCH-BJ-8801', code: 'A359808', shelf_id: 'SH-359808', phone: '137****2211', amount: 15.00, status: '已付款', source: '扫码开门购买', pay_type: '微信', refunds: 0, open_time: '2026-10-19 12:31:05', created_time: '2026-10-19 12:31:02' },
  { id: 2, customer_id: 1, order_no: 'DD20261019002', trade_no: 'TR991020002', merchant_no: 'MCH-BJ-8801', code: 'A359808', shelf_id: 'SH-359808', phone: '135****9087', amount: 8.50, status: '已退款', source: '扫码开门购买', pay_type: '支付宝', refunds: 1, open_time: '2026-10-19 13:02:44', created_time: '2026-10-19 13:02:40' },
  { id: 3, customer_id: 1, order_no: 'DD20261019003', trade_no: 'TR991020003', merchant_no: 'MCH-BJ-8801', code: 'A359812', shelf_id: 'SH-359812', phone: '188****3345', amount: 22.00, status: '已付款', source: '扫码开门购买', pay_type: '微信', refunds: 0, open_time: '2026-10-19 09:15:20', created_time: '2026-10-19 09:15:17' },
  { id: 4, customer_id: 1, order_no: 'DD20261018006', trade_no: 'TR991019998', merchant_no: 'MCH-BJ-8801', code: 'A360105', shelf_id: 'SH-360105', phone: '130****7766', amount: 6.50, status: '已付款', source: '异常订单盘点创建', pay_type: '-', refunds: 0, open_time: null, created_time: '2026-10-18 22:40:11' },
  { id: 5, customer_id: 2, order_no: 'DD20261019004', trade_no: 'TR991020004', merchant_no: 'MCH-BJ-8802', code: 'B400231', shelf_id: 'SH-400231', phone: '159****2210', amount: 12.00, status: '已付款', source: '扫码开门购买', pay_type: '微信', refunds: 0, open_time: '2026-10-19 14:22:03', created_time: '2026-10-19 14:22:00' },
];

const REPLENISHMENTS = [
  { id: 1, customer_id: 1, code: 'A359808', point_name: '望京SOHO-T3-1层大厅', replenish_no: 'BH20261015001', on_shelf_time: '2026-10-15 16:40', amount: 1280.00, sku_count: 42, status: '已上架' },
  { id: 2, customer_id: 1, code: 'A359812', point_name: '望京SOHO-T1-12层茶水间', replenish_no: 'BH20261017002', on_shelf_time: '2026-10-17 10:05', amount: 860.00, sku_count: 31, status: '已上架' },
  { id: 3, customer_id: 1, code: 'A360105', point_name: '望京花园东区-南门', replenish_no: 'BH20261019003', on_shelf_time: null, amount: 540.00, sku_count: 18, status: '配送中' },
  { id: 4, customer_id: 2, code: 'B400231', point_name: '国贸写字楼B座-2层', replenish_no: 'BH20261016004', on_shelf_time: '2026-10-16 11:20', amount: 990.00, sku_count: 35, status: '已上架' },
];

const WISHES = [
  { id: 1, customer_id: 1, code: 'A359808', product: '元气森林白桃味汽水 480ml', brand: '元气森林', fe_code: 'FEH0075', in_list: true, supply_status: '在售', report_count: 3, reporter: '王建军', reporter_phone: '13812345678', wish_type: '在售补货', qty: 12, period: 30 },
  { id: 2, customer_id: 1, code: 'A359808', product: '农夫山泉东方树叶青柑普洱 500ml', brand: '农夫山泉', fe_code: 'FEH0102', in_list: true, supply_status: '在售', report_count: 1, reporter: '王建军', reporter_phone: '13812345678', wish_type: '在售补货', qty: 24, period: 30 },
  { id: 3, customer_id: 1, code: 'A360105', product: '本地烘焙坚果礼盒装', brand: '-', fe_code: null, in_list: false, supply_status: '-', report_count: 0, reporter: '李芳', reporter_phone: '13711112222', wish_type: '新品提报', qty: 6, period: 60 },
];

const cat = i => CATEGORIES_SEED[i - 1];
// 工单：覆盖 5 种状态
const TICKETS = [
  { id: 1, ticket_no: 'GD20261020001', customer_id: 1, customer_name: '望京鲜生便利（演示）', region: '北京大区-朝阳', channel: '热线来单', biz_type: 'B端', cat_path: cat(1).path, cat_code: cat(1).code, shelf_id: 'SH-359812', shelf_code: 'A359812', risk: '投诉', urgency: '紧急', escalate: false, role: '店主', demand: 'A359812 货架这两天频繁掉线，顾客扫码开不了门，已经被投诉两次了，要求今天解决。', content: '客户来电反馈断网，设备离线频次高，已核对设备模块近30天断网9次，建议优先安排检修。', visible_content: '您好，我们已加急安排技术处理，预计24小时内恢复。', status: '待受理', handler: null, creator: '小艾（一线客服）', sla_hours: 4 },
  { id: 2, ticket_no: 'GD20261020002', customer_id: 1, customer_name: '望京鲜生便利（演示）', region: '北京大区-朝阳', channel: '企微留言', biz_type: 'B端', cat_path: cat(5).path, cat_code: cat(5).code, shelf_id: 'SH-359808', shelf_code: 'A359808', risk: '咨询', urgency: '一般', escalate: false, role: '企业对接人', demand: '望京SOHO-T3点位连续两周周末缺货，建议补货频次提高到每周两次。', content: '客户反馈周末客流大缺货明显，已转补货模块提交标签。', visible_content: '', status: '处理中', handler: '小何（二线工单）', creator: '小艾（一线客服）', sla_hours: 24 },
  { id: 3, ticket_no: 'GD20261019003', customer_id: 1, customer_name: '望京鲜生便利（演示）', region: '北京大区-朝阳', channel: '热线来单', biz_type: 'B端', cat_path: cat(9).path, cat_code: cat(9).code, shelf_id: 'SH-359808', shelf_code: 'A359808', risk: '投诉', urgency: '紧急', escalate: true, role: '顾客', demand: '顾客在货架上买到过期酸奶，要求退款并十倍赔偿。', content: '顾客来电称购买到过期商品，已安抚并登记理赔闭环，升级主管处理。', visible_content: '非常抱歉给您带来不好的体验，我们将为您办理退款并核实赔付。', status: '已完结', handler: '小何（二线工单）', creator: '小李（一线客服）', sla_hours: 4 },
  { id: 4, ticket_no: 'GD20261019004', customer_id: 2, customer_name: '国贸白领驿站（演示）', region: '北京大区-朝阳', channel: '在线客服', biz_type: 'B端', cat_path: cat(17).path, cat_code: cat(17).code, shelf_id: 'SH-400231', shelf_code: 'B400231', risk: '咨询', urgency: '一般', escalate: false, role: '企业对接人', demand: '8月起分点位待结算金额一直没到账，想核对一下明细。', content: '客户核对结算明细，已引导查看结算模块并说明账期。', visible_content: '您的结算明细已发送，请查收。', status: '待回访', handler: '小何（二线工单）', creator: '小艾（一线客服）', sla_hours: 24 },
  { id: 5, ticket_no: 'GD20261018005', customer_id: 1, customer_name: '望京鲜生便利（演示）', region: '北京大区-朝阳', channel: '自助工单', biz_type: 'B端', cat_path: cat(11).path, cat_code: cat(11).code, shelf_id: 'SH-359812', shelf_code: 'A359812', risk: '咨询', urgency: '一般', escalate: false, role: '店主', demand: '望京SOHO-T1点位下月要装修，申请撤架并咨询费用。', content: '客户自助提交撤架申请，待运营确认排期。', visible_content: '', status: '已挂起', handler: '小何（二线工单）', creator: '客户自助', sla_hours: 48 },
  { id: 6, ticket_no: 'GD20261018006', customer_id: 3, customer_name: '联洋社区超市（演示）', region: '上海大区-浦东', channel: '热线来单', biz_type: 'C端', cat_path: cat(29).path, cat_code: cat(29).code, shelf_id: 'SH-772190', shelf_code: 'C772190', risk: '舆情风险', urgency: '非常紧急', escalate: true, role: '顾客', demand: '顾客称在社交平台发帖曝光买到变质商品，要求立即处理。', content: '舆情风险工单，已升级值班主管，2小时内响应。', visible_content: '我们非常重视您反馈的问题，专员将尽快与您联系。', status: '处理中', handler: '小何（二线工单）', creator: '小李（一线客服）', sla_hours: 4 },
  { id: 7, ticket_no: 'GD20261017007', customer_id: 1, customer_name: '望京鲜生便利（演示）', region: '北京大区-朝阳', channel: '热线来单', biz_type: 'C端', cat_path: cat(29).path, cat_code: cat(29).code, shelf_id: 'SH-360105', shelf_code: 'A360105', risk: '投诉', urgency: '一般', escalate: false, role: '顾客', demand: '扣了钱没出货，要求退款6.5元。', content: '开门未出货扣款，已原路退款。', visible_content: '退款已受理，1-3个工作日到账。', status: '已完结', handler: '小何（二线工单）', creator: '小艾（一线客服）', sla_hours: 24 },
  { id: 8, ticket_no: 'GD20261016008', customer_id: 2, customer_name: '国贸白领驿站（演示）', region: '北京大区-朝阳', channel: '在线客服', biz_type: 'B端', cat_path: cat(21).path, cat_code: cat(21).code, shelf_id: 'SH-400231', shelf_code: 'B400231', risk: '咨询', urgency: '一般', escalate: false, role: '企业对接人', demand: '9月结算款什么时候打款？', content: '打款进度查询，已答复预计10月底统一打款。', visible_content: '预计10月底前完成打款。', status: '已完结', handler: '小何（二线工单）', creator: '小艾（一线客服）', sla_hours: 24 },
  { id: 9, ticket_no: 'GD20261020009', customer_id: 1, customer_name: '望京鲜生便利（演示）', region: '北京大区-朝阳', channel: '企微留言', biz_type: 'B端', cat_path: cat(18).path, cat_code: cat(18).code, shelf_id: 'SH-359808', shelf_code: 'A359808', risk: '咨询', urgency: '一般', escalate: false, role: '店主', demand: '想从个人卡结算转成对公账户结算，需要什么材料？', content: '转对公咨询，待二线答复材料清单。', visible_content: '', status: '待受理', handler: null, creator: '小艾（一线客服）', sla_hours: 24 },
  { id: 10, ticket_no: 'GD20261015010', customer_id: 1, customer_name: '望京鲜生便利（演示）', region: '北京大区-朝阳', channel: '热线来单', biz_type: 'C端', cat_path: cat(10).path, cat_code: cat(10).code, shelf_id: 'SH-359808', shelf_code: 'A359808', risk: '咨询', urgency: '一般', escalate: false, role: '顾客', demand: '饮料罐瘪了，想换一瓶。', content: '商品破损换货，已安排补发优惠券。', visible_content: '已为您发放优惠券，可到店使用。', status: '已完结', handler: '小何（二线工单）', creator: '小李（一线客服）', sla_hours: 24 },
];

const EVENTS = [
  { ticket_id: 1, actor: '小艾（一线客服）', action: '建单', detail: '热线来单，客户反馈货架频繁断网', h: 3 },
  { ticket_id: 1, actor: '小艾（一线客服）', action: '催办 → 小何（二线工单）', detail: '客户二次来电催促，要求今日解决', h: 2 },
  { ticket_id: 2, actor: '小艾（一线客服）', action: '建单', detail: '企微留言，缺货长期未补', h: 20 },
  { ticket_id: 2, actor: '小何（二线工单）', action: '受理', detail: '已受理，转补货运营确认频次', h: 16 },
  { ticket_id: 2, actor: '小何（二线工单）', action: '跟进', detail: '已联系客户核实周末缺货情况，补货频次调整方案已提交', h: 5 },
  { ticket_id: 3, actor: '小李（一线客服）', action: '建单', detail: '顾客购买到过期酸奶，要求退款+赔偿', h: 28 },
  { ticket_id: 3, actor: '小何（二线工单）', action: '受理', detail: '紧急工单，升级主管处理', h: 27 },
  { ticket_id: 3, actor: '小何（二线工单）', action: '跟进闭环', detail: '商品问题：商品过期；原路退款15元+现金赔付100元；处理说明已同步客户', h: 24 },
  { ticket_id: 3, actor: '小何（二线工单）', action: '完结', detail: '客户确认满意，工单完结', h: 23 },
  { ticket_id: 4, actor: '小艾（一线客服）', action: '建单', detail: '在线客服来单，待结算金额核对', h: 30 },
  { ticket_id: 4, actor: '小何（二线工单）', action: '受理', detail: '已受理，核对分点位结算明细', h: 28 },
  { ticket_id: 4, actor: '小何（二线工单）', action: '跟进', detail: '明细已发送客户，等待客户确认后回访', h: 8 },
  { ticket_id: 5, actor: '客户自助', action: '建单', detail: '自助工单，申请撤架', h: 50 },
  { ticket_id: 5, actor: '小何（二线工单）', action: '挂起', detail: '等待装修排期确认后恢复处理', h: 40 },
  { ticket_id: 6, actor: '小李（一线客服）', action: '建单', detail: '舆情风险工单，顾客扬言社交平台曝光', h: 26 },
  { ticket_id: 6, actor: '小何（二线工单）', action: '受理', detail: '已升级值班主管，正在联系顾客', h: 25 },
  { ticket_id: 6, actor: '小何（二线工单）', action: '跟进', detail: '已与顾客电话沟通，赔付方案沟通中', h: 4 },
  { ticket_id: 7, actor: '小艾（一线客服）', action: '建单', detail: '扣款未出货退款申请', h: 78 },
  { ticket_id: 7, actor: '小何（二线工单）', action: '受理', detail: '核实交易记录，确认未出货', h: 76 },
  { ticket_id: 7, actor: '小何（二线工单）', action: '完结', detail: '已原路退款6.5元', h: 70 },
  { ticket_id: 8, actor: '小艾（一线客服）', action: '建单', detail: '打款进度查询', h: 100 },
  { ticket_id: 8, actor: '小何（二线工单）', action: '完结', detail: '答复预计10月底统一打款', h: 95 },
  { ticket_id: 9, actor: '小艾（一线客服）', action: '建单', detail: '转对公结算办理咨询', h: 6 },
  { ticket_id: 10, actor: '小李（一线客服）', action: '建单', detail: '商品破损换货', h: 130 },
  { ticket_id: 10, actor: '小何（二线工单）', action: '完结', detail: '已发放优惠券', h: 126 },
];

const CLOSURES = [
  { id: 1, ticket_id: 3, product_codes: 'FEH0075/FEH0076', product_name: '原味酸奶 200g', problem: '商品过期', visible_issue: true, prod_date: '2026-08-30', decider: '主管-张强', refund_flag: '是', refuse_claim: false, demand_amount: 150.00, refund_amount: 15.00, pay_amount: 100.00, energy_points: 20, coupon_gift: '10元券×2', water_gift: '-', supplier_refund: 115.00, note: '过期商品，按标准赔付，供应商同步追偿。', updated_by: '小何（二线工单）' },
  { id: 2, ticket_id: 7, product_codes: 'FEH0231', product_name: '冰红茶 500ml', problem: '商品少货', visible_issue: false, prod_date: '2026-09-12', decider: '/', refund_flag: '是', refuse_claim: false, demand_amount: 6.50, refund_amount: 6.50, pay_amount: 0, energy_points: 5, coupon_gift: '-', water_gift: '-', supplier_refund: 0, note: '开门未出货，原路退款。', updated_by: '小何（二线工单）' },
];

// —— SQL 生成 ——
const out = [];
out.push('-- 客服工作台 migration（schema + RLS + 种子，幂等）—— gen_seed.js 生成');
out.push('');
// 建表
for (const [t, def] of Object.entries(SCHEMAS)) out.push(`CREATE TABLE IF NOT EXISTS ${t} (${def});`);
out.push('');
// RLS 放行
out.push("DO $$");
out.push("DECLARE t text;");
out.push("BEGIN");
out.push(`  FOREACH t IN ARRAY ARRAY[${BIZ_TABLES.map(t => `'${t}'`).join(',')}]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'wb_all_' || t) THEN
      EXECUTE format('CREATE POLICY wb_all_%I ON %I FOR ALL USING (true) WITH CHECK (true)', t, t);
    END IF;
  END LOOP;
END $$;`);
out.push('');
// users 种子（ON CONFLICT 幂等）
out.push('-- 演示账号（请上线后立即改密）');
for (const u of USERS) {
  out.push(`INSERT INTO users (id, username, password_hash, nick, role, status, permissions) VALUES (${u.id}, ${esc(u.username)}, ${esc(hashPw(u.password))}, ${esc(u.nick)}, ${esc(u.role)}, ${esc(u.status)}, ${esc(u.permissions)}) ON CONFLICT (username) DO NOTHING;`);
}
out.push('');
// 业务表种子（DELETE 先清再插，保证幂等 + 演示数据可重复执行）
const seeds = { customers: CUSTOMERS, categories: CATEGORIES_SEED, shelves: SHELVES, devices: DEVICES, contracts: CONTRACTS, settlements: SETTLEMENTS, trades: TRADES, replenishments: REPLENISHMENTS, wishes: WISHES, tickets: TICKETS, closures: CLOSURES };
const ts = (o, k) => o[k] !== undefined && o[k] !== null;
out.push('-- 业务演示种子（重复执行会重置为初始演示数据）');
for (const [t, rows] of Object.entries(seeds)) {
  const cols = Object.keys(rows[0]);
  out.push(`DELETE FROM ${t};`);
  for (const r of rows) {
    const vals = cols.map(c => ts(r, c) ? esc(r[c]) : 'NULL');
    out.push(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${vals.join(',')});`);
  }
}
// ticket_events 种子（引用 ticket_id）
out.push('DELETE FROM ticket_events;');
for (const e of EVENTS) {
  out.push(`INSERT INTO ticket_events (ticket_id, actor, action, detail, created_at) VALUES (${e.ticket_id}, ${esc(e.actor)}, ${esc(e.action)}, ${esc(e.detail)}, ${hoursAgo(e.h)});`);
}
out.push('');
// 序列校正（显式插 id 后保证后续自增不冲突）
for (const t of [...Object.keys(seeds), 'ticket_events', 'users']) {
  out.push(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1));`);
}
out.push('');
out.push(`INSERT INTO seed_meta (k, v) VALUES ('seed_version', 'kfwt-demo-1') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;`);
out.push('');
fs.writeFileSync(path.join(__dirname, 'migration.sql'), out.join('\n'));
console.log('migration.sql generated, lines:', out.length, '| categories:', CATEGORIES_SEED.length);
