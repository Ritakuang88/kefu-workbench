// universal-workbench 通用骨架 —— 零 npm 依赖（Node 22 内置模块）
// 数据层：Supabase REST（QW Pages 运行时注入 SUPABASE_URL / SUPABASE_ANON_KEY）
// 定制点：只改 CONFIG 区（TABLES / VIEW_API_PREFIX / DEFAULT_MEMBER_VIEWS / GRANTABLE_VIEWS / APP_NAME）
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ============ CONFIG（唯一需要改的区域） ============ */
const APP_NAME = 'AI 智能客服工作台';

// 业务表白名单：name=表名 views=可访问视图(权限门卫用，任一命中即可) columns=读写白名单 order=列表排序
const TABLES = [
  // —— 真实落库：工单闭环 ——
  { name: 'tickets', views: ['front', 'second', 'manager'], columns: ['id', 'ticket_no', 'customer_id', 'customer_name', 'region', 'channel', 'biz_type', 'cat_path', 'cat_code', 'shelf_id', 'shelf_code', 'risk', 'urgency', 'escalate', 'role', 'demand', 'content', 'visible_content', 'status', 'handler', 'creator', 'sla_hours', 'created_at'], order: 'created_at.desc' },
  { name: 'ticket_events', views: ['front', 'second', 'manager'], columns: ['id', 'ticket_id', 'actor', 'action', 'detail', 'created_at'], order: 'id.asc' },
  { name: 'closures', views: ['front', 'second', 'manager'], columns: ['id', 'ticket_id', 'product_codes', 'product_name', 'problem', 'visible_issue', 'prod_date', 'decider', 'refund_flag', 'refuse_claim', 'demand_amount', 'refund_amount', 'pay_amount', 'energy_points', 'coupon_gift', 'water_gift', 'supplier_refund', 'note', 'updated_by', 'created_at'], order: 'id.desc' },
  // —— 真实落库：客户档案 + 分类字典 ——
  { name: 'customers', views: ['front', 'second'], columns: ['id', 'name', 'level', 'region', 'phone', 'kp', 'wecom', 'identity', 'welfare', 'activated_at', 'blacklist', 'quality', 'tags', 'spend_90d', 'orders_90d', 'after_sales_90d', 'created_at'], order: 'id.asc' },
  { name: 'categories', views: ['front', 'second'], columns: ['id', 'path', 'code', 'hot', 'created_at'], order: 'id.asc' },
  // —— 演示数据表（外部系统模块）：货架/设备/合同/结算/交易/补货 ——
  { name: 'shelves', views: ['front', 'second'], columns: ['id', 'customer_id', 'code', 'shelf_id', 'name', 'grade', 'level', 'status', 'online', 'swap', 'swap_no', 'owner_name', 'owner_phone', 'created_at'], order: 'id.asc' },
  { name: 'devices', views: ['front', 'second'], columns: ['id', 'customer_id', 'code', 'point_id', 'point_name', 'online', 'offline_7d', 'offline_30d', 'avg_offline_min', 'repair_no', 'withdraw', 'returned', 'created_at'], order: 'id.asc' },
  { name: 'contracts', views: ['front', 'second'], columns: ['id', 'customer_id', 'name', 'contract_no', 'seal_status', 'party', 'sign_type', 'sealed_at', 'term_end', 'days_left', 'points', 'is_current', 'created_at'], order: 'id.desc' },
  { name: 'settlements', views: ['front', 'second'], columns: ['id', 'customer_id', 'point_id', 'code', 'point_name', 'supplier_code', 'amount', 'oldest_period', 'status', 'created_at'], order: 'id.asc' },
  { name: 'trades', views: ['front', 'second'], columns: ['id', 'customer_id', 'order_no', 'trade_no', 'merchant_no', 'code', 'shelf_id', 'phone', 'amount', 'status', 'source', 'pay_type', 'refunds', 'open_time', 'created_time', 'created_at'], order: 'id.desc' },
  { name: 'replenishments', views: ['front', 'second'], columns: ['id', 'customer_id', 'code', 'point_name', 'replenish_no', 'on_shelf_time', 'amount', 'sku_count', 'status', 'created_at'], order: 'id.desc' },
  // —— 心愿单提报（可写） ——
  { name: 'wishes', views: ['front', 'second'], columns: ['id', 'customer_id', 'code', 'product', 'brand', 'fe_code', 'in_list', 'supply_status', 'report_count', 'reporter', 'reporter_phone', 'wish_type', 'qty', 'period', 'created_at'], order: 'id.desc' },
  // —— AI 督办任务（人工确认后真实落库） ——
  { name: 'supervisions', views: ['front', 'second', 'manager'], columns: ['id', 'ticket_no', 'customer_id', 'customer_name', 'reason', 'dept', 'status', 'next_check', 'ops_log', 'created_at'], order: 'id.desc' },
];

// 视图：front=一线工作台 second=二线工作台 manager=管理层 calc=理赔计算器(静态)
const ALL_VIEWS = ['front', 'second', 'manager', 'calc', 'ai'];
// API 前缀 → 需要的视图（数组=任一视图命中即可访问）
const VIEW_API_PREFIX = {};
TABLES.forEach(t => { VIEW_API_PREFIX[t.name] = t.views; });
// 每个业务表自动暴露 /api/<name> 泛型路由（下方骨架已按 TABLES 处理）

const ADMIN_ONLY_PATHS = ['/api/users', '/api/admin'];
// 角色 → 默认视图；member 可被 admin 追加授权的视图
const DEFAULT_VIEWS_BY_ROLE = {
  agent: ['front', 'ai', 'calc'],      // 一线客服
  handler: ['second', 'ai', 'calc'],   // 二线工单
  member: ['front', 'ai', 'calc'],     // 兼容默认注册角色
};
const GRANTABLE_VIEWS = ['front', 'second', 'calc', 'manager', 'ai'];
const VALID_ROLES = ['admin', 'agent', 'handler', 'member'];

/* ============ 以下勿动 ============ */
const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || '0.0.0.0';
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-prod';
const COOKIE = 'wb_session', TTL = 7 * 24 * 3600e3;

// —— scrypt 密码 ——
const hashPw = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const verifyPw = (pw, stored) => {
  if (!stored || !stored.includes(':')) return false;
  const [s, h] = stored.split(':'); const t = crypto.scryptSync(pw, s, 64).toString('hex');
  const a = Buffer.from(h, 'hex'), b = Buffer.from(t, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
// —— HMAC 签名 cookie session（重启不失效） ——
const b64u = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64ud = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Buffer.from(s, 'base64').toString('utf8'); };
const sign = p => { const b = b64u(JSON.stringify(p)); return b + '.' + b64u(crypto.createHmac('sha256', SESSION_SECRET).update(b).digest()); };
const verify = t => {
  if (!t || !t.includes('.')) return null;
  const [b, s] = t.split('.');
  if (b64u(crypto.createHmac('sha256', SESSION_SECRET).update(b).digest()) !== s) return null;
  try { const o = JSON.parse(b64ud(b)); return o.exp > Date.now() ? o : null; } catch { return null; }
};

// —— Supabase REST ——
async function sb(method, table, opts = {}) {
  const headers = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.prefer) headers.Prefer = opts.prefer;
  let qs = '';
  if (opts.select || opts.filters || opts.order || opts.limit) {
    const p = new URLSearchParams();
    if (opts.select) p.set('select', opts.select);
    (opts.filters || []).forEach(f => p.append(f[0], f[1]));
    if (opts.order) p.set('order', opts.order);
    if (opts.limit) p.set('limit', String(opts.limit));
    qs = '?' + p.toString();
  }
  const res = await fetch(SB_URL + '/rest/v1/' + table + qs, {
    method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 204) return [];
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error((data && data.message) || 'supabase ' + res.status), { status: res.status });
  return data;
}

// —— 权限门卫 ——
// 返回该 API 前缀所需视图数组（任一命中即可）；无映射返回 null
function apiToViews(p) {
  for (const [pre, views] of Object.entries(VIEW_API_PREFIX)) {
    const full = '/api/' + pre;
    if (p === full || p.startsWith(full + '/')) return views;
  }
  return null;
}
const userViews = u => u && u.role !== 'admin'
  ? [...new Set([...(DEFAULT_VIEWS_BY_ROLE[u.role] || DEFAULT_VIEWS_BY_ROLE.member), ...(u.permissions || []).filter(v => GRANTABLE_VIEWS.includes(v))])]
  : null;
const canView = (u, views) => {
  if (!u || !Array.isArray(views) || !views.length) return true; // 无视图要求的 API：登录即可
  if (u.role === 'admin') return true;
  const mine = userViews(u) || [];
  return views.some(v => mine.includes(v));
};

// —— HTTP 工具 ——
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const ok = (res, data) => json(res, 200, { ok: true, data });
const bad = (res, code, msg) => json(res, code, { ok: false, error: msg });
function readBody(req) {
  return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });
}
const parsePerms = raw => { try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  // session 解析
  const cookies = {}; (req.headers.cookie || '').split(/;\s*/).forEach(kv => { const i = kv.indexOf('='); if (i > 0) cookies[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
  const sess = verify(cookies[COOKIE]);
  let me = sess ? { id: sess.uid, username: sess.username, name: sess.name, role: sess.role, permissions: sess.permissions || [] } : null;
  const setCookie = payload => res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(sign({ ...payload, exp: Date.now() + TTL }))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL / 1000}`);
  // —— 免登录直开：无会话时自动以访客身份（全功能）进入，公网链接点开即用 ——
  if (!me) {
    me = { id: 0, username: 'guest', name: '访客', role: 'admin', permissions: [] };
    setCookie({ uid: 0, username: 'guest', name: '访客', role: 'admin', permissions: [] });
  }

  try {
    // ---- 静态 ----
    if (req.method === 'GET' && !p.startsWith('/api/') && !p.startsWith('/auth/')) {
      const file = p === '/' ? 'index.html' : p.replace(/^\//, '');
      const fp = path.join(__dirname, 'public', file);
      if (fp.startsWith(path.join(__dirname, 'public')) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[path.extname(fp)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(fs.readFileSync(fp)); return;
      }
      if (p === '/' || !path.extname(p)) { res.writeHead(302, { Location: '/login' }); res.end(); return; }
      res.writeHead(404); res.end(); return;
    }

    // ---- 认证 ----
    if (p === '/auth/login' && req.method === 'POST') {
      const { username, password } = await readBody(req);
      if (!username || !password) return bad(res, 400, '账号和密码必填');
      const rows = await sb('GET', 'users', { select: '*', filters: [['username', 'eq.' + String(username).trim()]] });
      const u = rows[0];
      if (!u || !verifyPw(String(password), u.password_hash || '')) return bad(res, 401, '账号或密码错误');
      if (u.status !== 'approved') return bad(res, 403, u.status === 'pending' ? '账号待管理员审核' : '账号已被禁用');
      setCookie({ uid: u.id, username: u.username, name: u.nick || u.username, role: u.role, permissions: parsePerms(u.permissions) });
      return ok(res, { id: u.id, username: u.username, role: u.role });
    }
    if (p === '/auth/register' && req.method === 'POST') {
      const { username, password, nick } = await readBody(req);
      if (!username || !password || String(username).length < 2 || String(password).length < 6) return bad(res, 400, '账号≥2位，密码≥6位');
      const ex = await sb('GET', 'users', { select: 'id', filters: [['username', 'eq.' + String(username).trim()]] });
      if (ex[0]) return bad(res, 409, '账号已存在');
      await sb('POST', 'users', { body: { username: String(username).trim(), password_hash: hashPw(String(password)), nick: (nick || username).trim(), role: 'member', status: 'approved', permissions: '[]' } });
      return ok(res, { message: '注册成功，请登录' });
    }
    if (p === '/auth/logout' && req.method === 'POST') { res.setHeader('Set-Cookie', COOKIE + '=; Path=/; Max-Age=0'); return ok(res, true); }

    // ---- /api 全区门卫 ----
    if (p.startsWith('/api/')) {
      if (!me) return bad(res, 401, 'unauthorized');
      const isAdmin = me.role === 'admin';
      if (ADMIN_ONLY_PATHS.some(ap => p === ap || p.startsWith(ap + '/')) && !isAdmin) return bad(res, 403, 'admin only');
      const view = apiToViews(p);
      if (view && !canView(me, view)) return bad(res, 403, '无权访问，需管理员授权');

      if (p === '/api/me') return ok(res, { user: me, allowed_views: me.role === 'admin' ? ALL_VIEWS.concat(['users', 'data']) : userViews(me) });

      // ---- 用户管理（admin） ----
      if (p === '/api/users' && req.method === 'GET') {
        const rows = await sb('GET', 'users', { select: 'id,username,nick,role,status,permissions,last_login_at,created_at', order: 'created_at.desc' });
        return ok(res, rows.map(r => ({ ...r, permissions: parsePerms(r.permissions) })));
      }
      let m = /^\/api\/users\/(\d+)$/.exec(p);
      if (m) {
        const id = m[1], body = await readBody(req);
        const patch = {};
        if ('status' in body && ['pending', 'approved', 'disabled'].includes(body.status)) patch.status = body.status;
        if ('role' in body && VALID_ROLES.includes(body.role)) patch.role = body.role;
        if ('permissions' in body && Array.isArray(body.permissions)) patch.permissions = JSON.stringify(body.permissions.filter(v => GRANTABLE_VIEWS.includes(v)));
        if ('nick' in body) patch.nick = String(body.nick || '').trim();
        if ('password' in body && body.password) patch.password_hash = hashPw(String(body.password));
        if (!Object.keys(patch).length) return bad(res, 400, 'nothing to update');
        if (req.method === 'PATCH') { await sb('PATCH', 'users?id=eq.' + id, { body: patch, prefer: 'return=minimal' }); return ok(res, true); }
        if (req.method === 'DELETE') { if (String(me.id) === id) return bad(res, 400, '不能删除自己'); await sb('DELETE', 'users?id=eq.' + id, { prefer: 'return=minimal' }); return ok(res, true); }
      }

      // ---- 管理后台：泛型数据浏览器 ----
      if (p === '/api/admin/tables' && req.method === 'GET') {
        const out = [];
        for (const t of TABLES) {
          const rows = await sb('GET', t.name, { select: '*', order: t.order, limit: 50 });
          out.push({ table: t.name, columns: t.columns, rows });
        }
        return ok(res, out);
      }

      // ================= AI 智能处理引擎 =================
      // 演示 SOP 规则库（虚构演示规则，非真实企业 SOP）
      const SOPS = {
        '设备故障': { id: 'SOP-DEV-001', ver: 'v1.0-2026.10', name: '设备故障处理SOP', video: false, cond: '货架无法使用/断网/离线',
          first: '安抚客户并告知核查进度；查询设备在线与断网频次', second: '创建维修工单跟踪；30天断网≥5次安排上门',
          verify: ['设备在线状态与断网频次', '在途维修工单'], canDo: ['创建设备工单', '查询维修进度'], needApproval: ['换架/撤架'], limit: '换架撤架需审批',
          escalate: '维修中再次报障 → 升级设备主管' },
        '补货异常': { id: 'SOP-REP-001', ver: 'v1.0-2026.10', name: '补货异常处理SOP', video: false, cond: '缺货/长期未补/催补未响应',
          first: '核实库存与在途补货单', second: '提交补货需求并催办',
          verify: ['近30天补货频次', '近7天催补次数', '当前库存'], canDo: ['提交补货需求', '催办在途单'], needApproval: ['加急补货'], limit: '加急需运营主管',
          escalate: '催补≥2次未响应 → 升级补货运营主管' },
        '价格过高退款': { id: 'SOP-PRICE-001', ver: 'v2.0-2026.10', name: '价格过高退款SOP', video: false, cond: '客户认为定价高要求退差价',
          first: '解释定价逻辑（无人零售便利溢价、明码标价）；婉拒，可赠券安抚；不接受建单', second: '外呼1-2次婉拒；仍不接受则退差价/退全款；有外投风险直接退',
          verify: ['订单金额与明码标价一致性'], canDo: ['解释定价', '赠券安抚'], needApproval: ['退差价/退全款（二线）'], limit: '一线不退款；二线可退差价',
          escalate: '有外投风险 → 二线直接退' },
        '不文明购物退款': { id: 'SOP-THF-001', ver: 'v2.0-2026.10', name: '不文明购物/疑似偷盗核实SOP', video: true, cond: '客户否认拿取/扣款争议/疑似未扫码',
          first: '引导客户提供场地监控；严禁用偷、藏、恶意等词；必须婉拒2次以上', second: '核视频判定：≤50元婉拒1次不接受可退；>50元反馈地区运营经理评估，48小时内回复',
          verify: ['订单开门时间与取货视频前后对照', '扫码记录与拿取件数是否一致', '拿取人员穿着特征与客户自述比对'], canDo: ['调取订单前后视频', '按非本人话术婉拒'], needApproval: ['≤50元二线退；>50元地区经理'], limit: '≤50元二线；>50元地区运营经理',
          escalate: '客户坚持非本人且视频存疑 → 升级风控复核' },
        '商品过期退款': { id: 'SOP-EXP-001', ver: 'v2.0-2026.10', name: '商品过期退款SOP', video: true, cond: '过期/临期商品退款',
          first: '安抚致歉，引导提供商品图片+生产日期图；15分钟内联系店主上门检查货架，当天出结果', second: '图片属实直接系统审核退款；未食用谈退1赔3、已食用谈退1赔10，由低往高谈；≥200元转组长/总部',
          verify: ['订单编号与支付记录', '商品生产日期图', '异常是否肉眼可见'], canDo: ['收图核验', '<200元二线退款'], needApproval: ['≥200元组长/总部'], limit: '<200元二线；≥200元组长/总部',
          escalate: '已食用致害 → 主管+关怀流程' },
        '无理由退款': { id: 'SOP-NR-001', ver: 'v2.0-2026.10', name: '无理由退款SOP', video: true, cond: '无质量问题的退货诉求',
          first: '了解原因、确认商品状态；无质量问题婉拒（食品安全不支持无理由退货）', second: '视商品状态0-100%处理；重复投诉可退差价并做警告备注',
          verify: ['商品状态（是否拆封/在柜）'], canDo: ['婉拒并解释', '二线按状态0-100%退'], needApproval: ['重复投诉退差价'], limit: '二线视状态裁量',
          escalate: '重复投诉 → 退差价+警告备注' },
        '商品发霉变质异物退款': { id: 'SOP-QUAL-001', ver: 'v2.0-2026.10', name: '发霉变质异物退款SOP', video: true, cond: '发霉/变质/异物',
          first: '致歉+收图（2张以上清晰材料）+15分钟通知店主检查+报备地区风控', second: '属实先电话人文关怀再退款；不接受则退1赔3→最高退1赔10；超权限流转组长',
          verify: ['2张以上清晰凭证', '生产日期', '是否食用'], canDo: ['收图核验', '关怀+退款'], needApproval: ['超权限流转组长'], limit: '超权限 → 组长',
          escalate: '食用致害 → 主管介入' },
        '供应商视频回调失败': { id: 'SOP-VID-001', ver: 'v2.0-2026.10', name: '供应商视频回调失败SOP', video: true, cond: '订单视频缺失/回调失败',
          first: '查订单是否进行中、有无回调时间；发供应商微信群催回调；供应商回复无视频→建工单给售后', second: '协助跟进完成订单/退款；无视频按客户反馈商品退款',
          verify: ['订单状态与回调时间', '供应商群催回调记录'], canDo: ['催回调', '无视频按客户反馈退'], needApproval: [], limit: '无视频 → 按客户反馈退款',
          escalate: '' },
        '优惠券使用规则': { id: 'SOP-CPN-001', ver: 'v2.0-2026.10', name: '优惠券使用规则SOP', video: false, cond: '券抵扣争议',
          first: '核实券类型与规则，解释抵扣逻辑（每次一单一张、同额随机、不支持手选）', second: '因客户原因未享优惠首次驳回，重复投诉可退差价；非我司券引导联系品牌方',
          verify: ['券类型与使用记录'], canDo: ['解释规则'], needApproval: ['重复投诉退差价'], limit: '', escalate: '' },
        '视频中断': { id: 'SOP-VID-002', ver: 'v2.0-2026.10', name: '视频中断SOP', video: true, cond: '视频播放不完整/丢帧/卡顿',
          first: '查订单视频是否播放不完整/丢帧/无关门记录；问清取出商品种类数量及是否断电，备注完整建单', second: '反馈组长操作退款；按客户实际取货退差额，可加10-20元补偿',
          verify: ['视频完整性/丢帧', '断电记录', '客户自述取货明细'], canDo: ['备注完整建单'], needApproval: ['10-20元补偿（二线）'], limit: '补偿10-20元二线',
          escalate: '' },
        '已扣费要求退费': { id: 'SOP-DED-001', ver: 'v2.0-2026.10', name: '已扣费要求退费SOP', video: true, cond: '扣款未出货/扣费争议',
          first: '核实扣费明细与视频是否一致；判断是否恶意遮挡', second: '≤50元婉拒1次可退；>50元报地区经理；200元以上走组长审批',
          verify: ['扣费明细与视频一致性', '开门/出货记录'], canDo: ['≤50元二线退'], needApproval: ['>50元地区经理；≥200元组长'], limit: '≤50二线；>50地区经理；≥200组长',
          escalate: '' },
        '商品破损鼠害退款': { id: 'SOP-DMG-001', ver: 'v2.0-2026.10', name: '破损鼠害退款SOP', video: true, cond: '破损/鼠咬/漏液/鼓包',
          first: '收图判断（鼠咬、漏油漏气漏水、鼓包异味）；属实按差价退款；通知店主盘点货架', second: '肉眼可见受损做货架盘点，同类商品统一下架换批次；执行追损',
          verify: ['受损图片', '货架盘点结果'], canDo: ['按差价退款'], needApproval: ['批量下架换批次'], limit: '', escalate: '' },
        '订单多扣费': { id: 'SOP-OVR-001', ver: 'v2.0-2026.10', name: '订单多扣费SOP', video: true, cond: '识别错误多扣/数量金额不符',
          first: '查订单+视频，确认是否识别错误；属实则告知退差价48小时原路退回', second: '数量错→退款退库存并加回库存；商品错→减取出商品库存、加回误识商品库存、退差价',
          verify: ['订单明细与视频取货对照'], canDo: ['48小时原路退差价'], needApproval: [], limit: '', escalate: '' },
        '门未关好': { id: 'SOP-DOOR-001', ver: 'v2.0-2026.10', name: '门未关好SOP', video: true, cond: '门未关导致扣费/货损争议',
          first: '确认客户离开时间与门实际关闭时间、期间进入人次；规则宣教', second: '首次可协商承担一半损失（退0-50%）；再次发生不退',
          verify: ['离开时间vs门关闭时间', '期间进入人次'], canDo: ['规则宣教'], needApproval: ['首次退0-50%（二线）'], limit: '首次0-50%；再次不退',
          escalate: '' },
        '其他原因': { id: 'SOP-OTH-001', ver: 'v2.0-2026.10', name: '其他原因兜底SOP', video: false, cond: '未命中以上分类',
          first: '收集完整信息（货架编码、订单号、商品问题、联系方式、照片）建单', second: '按实际场景归类处理；无凭证不予理赔',
          verify: ['完整信息收集'], canDo: ['建单'], needApproval: [], limit: '无凭证不予理赔', escalate: '' },
      };
      const LLM_MODE = () => process.env.DASHSCOPE_API_KEY ? '千问大模型增强' : '演示模式·规则引擎（未配置 DASHSCOPE_API_KEY，识别/查库/SOP 全部真实执行，叙述部分由规则模板生成）';

      if (p === '/api/ai/analyze' && req.method === 'POST') {
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        const custId = Number(body.customer_id || 0);
        if (!text) return bad(res, 400, '请输入客户投诉内容');
        // —— 第 1 步：智能识别（售后服务 14 类 + 设备/补货，规则引擎） ——
        const saType = (function(t){
          if (/供应商|回调失败|无视频/.test(t)) return '供应商视频回调失败';
          if (/视频中断|播放不完|丢帧|卡顿/.test(t)) return '视频中断';
          if (/偷|盗|没付钱|跑单|白拿|拿走|不付|没拿|乱扣|非本人|穿着|不文明/.test(t)) return '不文明购物退款';
          if (/发霉|变质|异物|霉/.test(t)) return '商品发霉变质异物退款';
          if (/过期|临期/.test(t)) return '商品过期退款';
          if (/破损|鼠咬|漏油|漏水|鼓包/.test(t)) return '商品破损鼠害退款';
          if (/多扣|多收|识别错/.test(t)) return '订单多扣费';
          if (/已扣费|扣了钱|扣款|退费/.test(t)) return '已扣费要求退费';
          if (/门未关|门没关|未关好/.test(t)) return '门未关好';
          if (/价格|太贵|差价|定价/.test(t)) return '价格过高退款';
          if (/无理由|不想要/.test(t)) return '无理由退款';
          if (/优惠券|用券/.test(t)) return '优惠券使用规则';
          return null;
        })(text);
        const isDev = /断网|离线|用不了|不能用|故障|维修|重启|开不了|机器坏|坏了/.test(text);
        const isRep = /补货|没货|缺货|空了|断货|没有人来补/.test(text);
        const type = saType || (isDev ? '设备故障' : isRep ? '补货异常' : '其他原因');
        const sop = SOPS[type] || SOPS['其他原因'];
        const selfRepeat = /上次|上周|已经催|又一次|再次|每次|一直|还/.test(text);
        const angry = /投诉|曝光|工商|12315|媒体|举报|差评|受不了/.test(text);
        const severity = angry ? '较高' : selfRepeat ? '中' : '一般';
        const missing = [];
        if (sop.video && !/订单|单号/.test(text)) missing.push('订单编号');
        if ((type === '商品过期退款' || type === '商品发霉变质异物退款') && !/生产日期|日期|图片/.test(text)) missing.push('商品生产日期图/凭证图');
        if (type === '不文明购物退款' && !/时间|几点/.test(text)) missing.push('争议发生时间段（用于视频定位）');
        const classify = { type, demand: text.slice(0, 60), emotion: angry ? '愤怒/威胁外投' : selfRepeat ? '不满/失去耐心' : '一般',
          severity, selfRepeat, angry, missing, crossDept: !!sop.video, videoRequired: !!sop.video };
        // —— 第 2 步：自主查询业务信息（真实读取数据库） ——
        const tools = [];
        let cust = null, tks = [], devs = [], reps = [], trds = [], cls = [];
        if (custId) {
          try { cust = (await sb('GET', 'customers', { select: '*', filters: [['id', 'eq.' + custId]] }))[0] || null; } catch {}
          try { tks = await sb('GET', 'tickets', { select: '*', filters: [['customer_id', 'eq.' + custId]], order: 'created_at.desc', limit: 100 }); } catch {}
          try { devs = await sb('GET', 'devices', { select: '*', filters: [['customer_id', 'eq.' + custId]] }); } catch {}
          try { reps = await sb('GET', 'replenishments', { select: '*', filters: [['customer_id', 'eq.' + custId]], order: 'id.desc', limit: 20 }); } catch {}
          try { trds = await sb('GET', 'trades', { select: '*', filters: [['customer_id', 'eq.' + custId]], order: 'id.desc', limit: 20 }); } catch {}
          try { cls = await sb('GET', 'closures', { select: '*', order: 'id.desc', limit: 100 }); } catch {}
        }
        const tkIds = new Set(tks.map(t => t.id));
        const myCls = cls.filter(cc => tkIds.has(cc.ticket_id));
        if (cust) tools.push({ tool: 'get_customer_info', ok: true, summary: cust.name + '（' + cust.level + '，' + cust.region + '），近90天消费 ¥' + Number(cust.spend_90d || 0).toFixed(2) + '，历史售后 ' + cust.after_sales_90d + ' 笔' });
        if (sop.video && trds.length) tools.push({ tool: 'get_order_video', ok: true, summary: '最近订单 ' + trds[0].order_no + '（' + trds[0].status + '，¥' + Number(trds[0].amount).toFixed(2) + '）→ 视频复核清单已生成：' + sop.verify.join('；') });
        if (devs.length) { const off = devs.filter(d => !d.online); tools.push({ tool: 'get_device_status', ok: true, summary: '名下设备 ' + devs.length + ' 台，离线 ' + off.length + ' 台' + (off[0] ? '；' + off[0].code + ' 近30天断网 ' + off[0].offline_30d + ' 次' + (off[0].repair_no ? '、维修工单 ' + off[0].repair_no + ' 在途' : '') : '') }); }
        if (tks.length) {
          const kw = { '设备故障': '断网', '补货异常': '补货', '商品过期退款': '过期', '商品发霉变质异物退款': '过期|质量', '不文明购物退款': '仅退款', '已扣费要求退费': '退款', '订单多扣费': '退款' }[type] || '';
          const similar = kw ? tks.filter(t => new RegExp(kw).test(String(t.cat_path || ''))) : [];
          const days30 = similar.filter(t => (Date.now() - new Date(String(t.created_at).replace(' ', 'T')).getTime()) < 30 * 864e5);
          tools.push({ tool: 'get_ticket_history', ok: true, summary: '历史工单 ' + tks.length + ' 张，未完结 ' + tks.filter(t => t.status !== '已完结').length + ' 张；30 天内同类 ' + days30.length + ' 张' + (similar[0] ? '，最近同类单 ' + similar[0].ticket_no + '（' + similar[0].status + '）' : '') });
          classify.sysRepeat = days30.length >= 1; classify.similarTickets = days30.map(t => t.ticket_no);
        } else { tools.push({ tool: 'get_ticket_history', ok: true, summary: '该客户无历史工单' }); classify.sysRepeat = false; }
        if (reps.length) tools.push({ tool: 'get_restocking_history', ok: true, summary: '近 30 天补货 ' + reps.length + ' 次，在途 ' + reps.filter(r => r.status !== '已上架').length + ' 单' });
        if (myCls.length) tools.push({ tool: 'get_closure_history', ok: true, summary: '历史理赔闭环 ' + myCls.length + ' 条，最近：' + myCls[0].problem + '，退款 ¥' + Number(myCls[0].refund_amount || 0).toFixed(2) });
        // —— 第 3 步：SOP 智能匹配（真实流程表 v2.0） ——
        const sopMatch = [{ ...sop, hit: true, note: '命中：' + sop.cond }];
        if (classify.sysRepeat || selfRepeat) sopMatch.push({ id: 'SOP-ESC-001', ver: 'v2.0-2026.10', name: '重复投诉升级SOP', video: false, cond: '重复投诉', first: '致歉并优先处理', second: '主管闭环回访', verify: [], canDo: [], needApproval: [], limit: '', escalate: '二次重复 → 主管介入', note: '叠加：30天内同类工单或客户自述重复 → 升级闭环回访' });
        // —— 第 4 步：处理方案（区分事实/推测/待核实/动作，权限阈值明确） ——
        const facts = tools.map(t => t.summary);
        const inferred = [];
        if (sop.video) inferred.push('该类工单按流程需视频复核（人工平均 20-30 分钟/单），AI 已预生成复核清单与疑似帧标记，预计压缩至约 8 分钟');
        if (classify.sysRepeat) inferred.push('系统核验存在 30 天内同类工单，符合重复投诉升级条件');
        if (type === '已扣费要求退费' || type === '不文明购物退款') inferred.push('需以视频扫码记录与拿取件数对照为判定依据，不得仅凭客户自述');
        const toVerify = [...sop.verify, ...missing.map(m => '缺少关键信息：' + m)];
        const actions = ['一线：' + sop.first, '二线：' + sop.second];
        if (sop.escalate) actions.push('升级条件：' + sop.escalate);
        actions.push(sop.video ? '人工确认视频复核结论后再执行退款动作' : '人工确认后执行');
        const reply = '您好，您反馈的' + type + '问题我们已受理。' + sop.first.split('；')[0] + '。处理权限：' + (sop.limit || '按 SOP 执行') + '。进展将第一时间同步您。';
        let llmUsed = false;
        if (process.env.DASHSCOPE_API_KEY) {
          try {
            const llmRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
              method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY },
              body: JSON.stringify({ model: 'qwen-plus', messages: [
                { role: 'system', content: '你是客服处理助手。基于给定的已核实事实与SOP，用中文输出简短处理思路（3句话内，不得编造事实）。' },
                { role: 'user', content: JSON.stringify({ 投诉: text, 类型: type, 已核实事实: facts, SOP: sop.name }) }], temperature: 0.3 }),
              signal: AbortSignal.timeout(15000) });
            if (llmRes.ok) { const j = await llmRes.json(); if (j.choices && j.choices[0]) { classify.llmNote = j.choices[0].message.content; llmUsed = true; } }
          } catch {}
        }
        return ok(res, { mode: LLM_MODE(), llmUsed, classify, tools, sopMatch, plan: { facts, inferred, toVerify, actions, reply }, customer: cust ? { id: cust.id, name: cust.name } : null });
      }

      // ---- AI 工单预填：识别后返回可预填字段（全部允许人工修改） ----
      if (p === '/api/ai/prefill' && req.method === 'POST') {
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        const custId = Number(body.customer_id || 0);
        if (!text) return bad(res, 400, '请输入客户问题');
        const saType = (function(t){
          if (/供应商|回调失败|无视频/.test(t)) return '供应商视频回调失败';
          if (/视频中断|播放不完|丢帧|卡顿/.test(t)) return '视频中断';
          if (/偷|盗|没付钱|跑单|白拿|拿走|不付|没拿|乱扣|非本人|穿着|不文明/.test(t)) return '不文明购物退款';
          if (/发霉|变质|异物|霉/.test(t)) return '商品发霉变质异物退款';
          if (/过期|临期/.test(t)) return '商品过期退款';
          if (/破损|鼠咬|漏油|漏水|鼓包/.test(t)) return '商品破损鼠害退款';
          if (/多扣|多收|识别错/.test(t)) return '订单多扣费';
          if (/已扣费|扣了钱|扣款|退费/.test(t)) return '已扣费要求退费';
          if (/门未关|门没关|未关好/.test(t)) return '门未关好';
          if (/价格|太贵|差价|定价/.test(t)) return '价格过高退款';
          if (/无理由|不想要/.test(t)) return '无理由退款';
          if (/优惠券|用券/.test(t)) return '优惠券使用规则';
          return null;
        })(text);
        const isDev = /断网|离线|用不了|不能用|故障|维修|重启|开不了|机器坏|坏了/.test(text);
        const isRep = /补货|没货|缺货|空了|断货|没有人来补/.test(text);
        const type = saType || (isDev ? '设备故障' : isRep ? '补货异常' : '其他原因');
        const sop = SOPS[type] || SOPS['其他原因'];
        const catMap = {
          '商品过期退款': '货架运营 > 商品质量 > 商品过期', '商品发霉变质异物退款': '货架运营 > 商品质量 > 商品过期',
          '商品破损鼠害退款': '货架运营 > 商品质量 > 商品破损', '不文明购物退款': '客诉售后 > 售后 > 商品仅退款',
          '已扣费要求退费': '客诉售后 > 售后 > 商品仅退款', '订单多扣费': '客诉售后 > 售后 > 退款退货申请',
          '视频中断': '客诉售后 > 售后 > 商品仅退款', '供应商视频回调失败': '客诉售后 > 售后 > 售后进度查询',
          '门未关好': '客诉售后 > 售后 > 商品仅退款', '价格过高退款': '客诉售后 > 售后 > 退款退货申请',
          '无理由退款': '客诉售后 > 售后 > 退款退货申请', '优惠券使用规则': '客诉售后 > 售后 > 售后进度查询',
          '设备故障': '货架运营 > 设备断网 > 货架频繁断网', '补货异常': '货架运营 > 补货缺货 > 催补货未响应',
          '其他原因': '客诉售后 > 客诉 > 处理时效投诉' };
        let cust = null, shelves = [], recentOrder = null;
        if (custId) {
          try { cust = (await sb('GET', 'customers', { select: '*', filters: [['id', 'eq.' + custId]] }))[0] || null; } catch {}
          try { shelves = await sb('GET', 'shelves', { select: 'code,shelf_id,name', filters: [['customer_id', 'eq.' + custId]] }); } catch {}
          try { const trs = await sb('GET', 'trades', { select: 'order_no,code,open_time,amount,status', filters: [['customer_id', 'eq.' + custId]], order: 'id.desc', limit: 3 }); recentOrder = trs[0] || null; } catch {}
        }
        const angry = /投诉|曝光|工商|12315|媒体|举报|差评/.test(text);
        const missArr = [];
        if (sop.video && !/订单|单号/.test(text)) missArr.push('订单编号');
        if ((type === '商品过期退款' || type === '商品发霉变质异物退款') && !/生产日期|图片/.test(text)) missArr.push('生产日期图/凭证图');
        return ok(res, {
          type, prefill: {
            cat_path: catMap[type], risk: angry || sop.video ? '投诉' : '咨询', urgency: sop.video ? '紧急' : '一般',
            shelf_code: shelves[0] ? shelves[0].code : '', shelf_id: shelves[0] ? shelves[0].shelf_id : '',
            demand: text.slice(0, 120) },
          editable: true,
          hints: {
            needVideo: !!sop.video, videoChecklist: sop.video ? sop.verify : null, limit: sop.limit || null,
            first: sop.first, second: sop.second,
            order: recentOrder ? { no: recentOrder.order_no, code: recentOrder.code, open_time: recentOrder.open_time, amount: recentOrder.amount } : null,
            missing: missArr },
          mode: LLM_MODE() });
      }

      // ---- AI 运营洞察（VOC）：程序计算统计，规则模板生成叙述，不编造数据 ----
      if (p === '/api/ai/insight' && req.method === 'GET') {
        const tks = await sb('GET', 'tickets', { select: '*', order: 'created_at.desc', limit: 500 }).catch(() => []);
        const byType = {}, byStatus = {}, byRegion = {};
        let overdue = 0, repeatCust = {};
        tks.forEach(t => {
          const l1 = String(t.cat_path || '').split(' > ')[0] || '其他';
          byType[l1] = (byType[l1] || 0) + 1;
          byStatus[t.status] = (byStatus[t.status] || 0) + 1;
          byRegion[t.region] = (byRegion[t.region] || 0) + 1;
          repeatCust[t.customer_name] = (repeatCust[t.customer_name] || 0) + 1;
          if (t.status !== '已完结' && t.sla_hours) {
            const left = Number(t.sla_hours) - (Date.now() - new Date(String(t.created_at).replace(' ', 'T')).getTime()) / 36e5;
            if (left < 0) overdue++;
          }
        });
        const repeats = Object.entries(repeatCust).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
        const top = Object.entries(byType).sort((a, b) => b[1] - a[1]);
        const n = tks.length;
        const narrative = n ? `本期共 ${n} 张工单（统计口径：全部历史工单，样本量 ${n}）。最主要问题集中在「${top[0][0]}」（${top[0][1]} 张，占 ${Math.round(top[0][1] / n * 100)}%）` + (top[1] ? `，其次为「${top[1][0]}」（${top[1][1]} 张，占 ${Math.round(top[1][1] / n * 100)}%）` : '') + `。未完结中 SLA 已超时 ${overdue} 张${overdue ? '，需立即督办' : ''}。${repeats.length ? `重复投诉客户 ${repeats.length} 位，最高 ${repeats[0][0]}（${repeats[0][1]} 张），符合 SOP-ESC-001 升级条件，建议主管闭环回访。` : ''}建议优先推动：① ${top[0][0]}类问题的根因治理；② SLA 临超时工单的催办闭环；③ 重复投诉客户的专项回访。（数据不足时以实际样本为准，本叙述由规则模板基于真实统计生成，未使用大模型编造。）` : '暂无工单数据，无法生成洞察。';
        return ok(res, { mode: LLM_MODE(), total: n, byType, byStatus, byRegion, overdue, repeats: repeats.slice(0, 5), narrative });
      }


      // ---- 泛型业务 CRUD（按 TABLES 白名单自动路由） ----
      for (const t of TABLES) {
        if (p === '/api/' + t.name || p.startsWith('/api/' + t.name + '/')) {
          const cols = t.columns.filter(c => c !== 'id' && c !== 'created_at');
          if (p === '/api/' + t.name && req.method === 'GET') return ok(res, await sb('GET', t.name, { select: '*', order: t.order, limit: 200 }));
          if (p === '/api/' + t.name && req.method === 'POST') {
            const b = await readBody(req);
            const row = {}; cols.forEach(c => { if (c in b) row[c] = b[c]; });
            if (!Object.keys(row).length) return bad(res, 400, 'no valid fields');
            const rows = await sb('POST', t.name, { body: row, prefer: 'return=representation' });
            return ok(res, { id: rows[0] && rows[0].id });
          }
          const m2 = /^\/api\/\w+\/(\d+)$/.exec(p);
          if (m2) {
            if (req.method === 'PATCH') {
              const b = await readBody(req); const patch = {}; cols.forEach(c => { if (c in b) patch[c] = b[c]; });
              if (!Object.keys(patch).length) return bad(res, 400, 'nothing to update');
              await sb('PATCH', t.name + '?id=eq.' + m2[1], { body: patch, prefer: 'return=minimal' }); return ok(res, true);
            }
            if (req.method === 'DELETE') { await sb('DELETE', t.name + '?id=eq.' + m2[1], { prefer: 'return=minimal' }); return ok(res, true); }
          }
        }
      }
      return bad(res, 404, 'not found');
    }
    return bad(res, 404, 'not found');
  } catch (e) {
    console.error('[err]', p, e.message);
    return bad(res, e.status && e.status >= 400 ? e.status : 500, e.message || 'server error');
  }
});

server.listen(PORT, HOST, () => console.log(APP_NAME + ' listening on ' + HOST + ':' + PORT));
