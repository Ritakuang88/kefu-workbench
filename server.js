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
        '设备故障': { id: 'SOP-DEV-001', ver: 'v1.0-2026.10', name: '设备故障处理SOP', cond: '客户反馈货架无法使用/断网/离线',
          verify: ['设备在线状态与断网频次（7天/30天）', '是否存在在途维修工单', '是否已有撤架任务'],
          canDo: ['安抚客户并告知核查进度', '创建设备故障工单', '查询维修工单进度'],
          needApproval: ['换架/撤架流程', '赔付类动作'],
          escalate: '30 天断网 ≥5 次或维修中再次报障 → 升级设备主管并安排上门' },
        '补货异常': { id: 'SOP-REP-001', ver: 'v1.0-2026.10', name: '补货异常处理SOP', cond: '客户反馈缺货/长期未补/催补未响应',
          verify: ['近 30 天补货频次与在途单', '近 7 天催补货次数', '当前库存与缺货 SKU'],
          canDo: ['提交补货需求（含风险标签）', '对在途补货单发起催办'],
          needApproval: ['加急补货（超出常规频次）'],
          escalate: '催补 ≥2 次未响应 → 升级补货运营主管' },
        '商品质量': { id: 'SOP-QUAL-001', ver: 'v1.0-2026.10', name: '商品质量处理SOP', cond: '过期/变质/异物/破损等质量问题',
          verify: ['订单编号与支付记录', '商品生产日期（实物凭证）', '异常是否肉眼可见'],
          canDo: ['原路退款 ≤ ¥200（客服权限内）', '安抚并登记理赔闭环'],
          needApproval: ['赔付金额 > ¥200', '食用致害类需主管决策'],
          escalate: '食用致害/重大质量 → 升级主管+客户关怀流程' },
        '退款异常': { id: 'SOP-REF-001', ver: 'v1.0-2026.10', name: '退款异常处理SOP', cond: '扣款未出货/多扣/退款未到账',
          verify: ['订单状态与开门记录', '退款记录笔数与到账状态'],
          canDo: ['未出货扣款直接原路退款', '查询退款进度并答复'],
          needApproval: ['退款金额 > ¥500'],
          escalate: '重复扣款 3 次以上 → 升级技术排查' },
        '重复投诉升级': { id: 'SOP-ESC-001', ver: 'v1.0-2026.10', name: '重复投诉升级SOP', cond: '系统核验 30 天内同类工单 ≥2',
          verify: ['历史同类工单处理结果', '上次承诺与兑现情况'],
          canDo: ['致歉并优先处理', '创建督办任务闭环跟进'],
          needApproval: ['赔付方案'],
          escalate: '二次重复投诉 → 主管介入+完结后主动回访' },
      };
      const LLM_MODE = () => process.env.DASHSCOPE_API_KEY ? '千问大模型增强' : '演示模式·规则引擎（未配置 DASHSCOPE_API_KEY，识别/查库/SOP 全部真实执行，叙述部分由规则模板生成）';

      if (p === '/api/ai/analyze' && req.method === 'POST') {
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        const custId = Number(body.customer_id || 0);
        if (!text) return bad(res, 400, '请输入客户投诉内容');
        // —— 第 1 步：智能识别（规则引擎，确定性输出） ——
        const isQual = /过期|变质|异物|发霉|质量|坏掉|破损/.test(text);
        const isRep = /补货|没货|缺货|空了|断货|上架|没有人来补/.test(text);
        const isDev = /断网|离线|用不了|不能用|故障|维修|重启|开不了|机器坏|坏了/.test(text);
        const isRef = /退款|退钱|扣了钱|多扣|退回|扣款/.test(text);
        const type = isQual ? '商品质量' : isDev && !isQual ? '设备故障' : isRep ? '补货异常' : isRef ? '退款异常' : '其他咨询';
        const selfRepeat = /上次|上周|已经催|又一次|再次|每次|一直|还/.test(text);  // 客户自述曾投诉
        const angry = /投诉|曝光|工商|12315|媒体|举报|差评|受不了/.test(text);
        const severity = angry ? '较高' : selfRepeat ? '中' : '一般';
        const missing = [];
        if (type === '商品质量' && !/订单|买的|购买/.test(text)) missing.push('订单编号');
        if (type === '商品质量' && !/生产日期|日期/.test(text)) missing.push('商品生产日期');
        if (type === '退款异常' && !/订单|扣了|金额|元/.test(text)) missing.push('订单编号与扣款金额');
        if (type === '设备故障' && !/货架|A\d{6}|点位|柜/.test(text)) missing.push('具体货架编码或点位');
        const classify = { type, demand: text.slice(0, 60), emotion: angry ? '愤怒/威胁外投' : selfRepeat ? '不满/失去耐心' : '一般',
          severity, selfRepeat, angry, missing, crossDept: type !== '其他咨询' };
        // —— 第 2 步：自主查询业务信息（真实读取数据库，非 AI 编造） ——
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
        const myCls = cls.filter(c => tkIds.has(c.ticket_id));
        if (cust) tools.push({ tool: 'get_customer_profile', ok: true, summary: `${cust.name}（${cust.level}，${cust.region}），近90天消费 ¥${Number(cust.spend_90d || 0).toFixed(2)}，历史售后 ${cust.after_sales_90d} 笔` });
        if (devs.length) {
          const off = devs.filter(d => !d.online);
          tools.push({ tool: 'get_equipment_status', ok: true, summary: `名下设备 ${devs.length} 台，离线 ${off.length} 台` + (off[0] ? `；${off[0].code} 近30天断网 ${off[0].offline_30d} 次、平均恢复 ${off[0].avg_offline_min} 分钟${off[0].repair_no ? `、维修工单 ${off[0].repair_no} 在途` : '、无在途维修工单'}` : '') });
        } else tools.push({ tool: 'get_equipment_status', ok: true, summary: '该客户名下无设备记录' });
        if (tks.length) {
          const open = tks.filter(t => t.status !== '已完结');
          const kw = { '设备故障': '断网', '补货异常': '补货', '商品质量': '过期|质量|破损', '退款异常': '退款' }[type] || '';
          const similar = kw ? tks.filter(t => new RegExp(kw).test(String(t.cat_path || ''))) : [];
          const days30 = similar.filter(t => (Date.now() - new Date(String(t.created_at).replace(' ', 'T')).getTime()) < 30 * 864e5);
          tools.push({ tool: 'get_ticket_history', ok: true, summary: `历史工单 ${tks.length} 张，未完结 ${open.length} 张；30 天内同类（${type}）工单 ${days30.length} 张${similar[0] ? '，最近同类单 ' + similar[0].ticket_no + '（' + similar[0].status + '）' : ''}` });
          classify.sysRepeat = days30.length >= 1;  // 系统核验的重复投诉（区别于客户自述）
          classify.similarTickets = days30.map(t => t.ticket_no);
        } else { tools.push({ tool: 'get_ticket_history', ok: true, summary: '该客户无历史工单' }); classify.sysRepeat = false; }
        if (reps.length) tools.push({ tool: 'get_restocking_history', ok: true, summary: `近 30 天补货 ${reps.length} 次，在途 ${reps.filter(r => r.status !== '已上架').length} 单` + (reps[0] ? `，最近一单 ${reps[0].replenish_no}（${reps[0].status}，¥${Number(reps[0].amount).toFixed(2)}）` : '') });
        if (trds.length) tools.push({ tool: 'get_order_details', ok: true, summary: `最近订单 ${trds[0].order_no}（${trds[0].status}，¥${Number(trds[0].amount).toFixed(2)}），含退款记录 ${trds.reduce((s, t) => s + (t.refunds || 0), 0)} 笔` });
        if (myCls.length) tools.push({ tool: 'get_closure_history', ok: true, summary: `历史理赔闭环 ${myCls.length} 条，最近：${myCls[0].problem}，退款 ¥${Number(myCls[0].refund_amount || 0).toFixed(2)} + 赔付 ¥${Number(myCls[0].pay_amount || 0).toFixed(2)}` });
        // —— 第 3 步：SOP 智能匹配 ——
        const sops = [SOPS[type]].filter(Boolean);
        if (classify.sysRepeat || (selfRepeat && classify.similarTickets)) sops.push(SOPS['重复投诉升级']);
        const sopMatch = sops.map(s => ({ ...s, hit: true, note: '命中：' + s.cond }));
        if (!sopMatch.length) sopMatch.push({ id: null, note: '未找到可靠的处理依据，需要人工判断（严禁编造赔付规定与服务承诺）' });
        // —— 第 4 步：生成处理方案（区分已核实事实 / AI推测 / 待核实 / 建议动作） ——
        const facts = tools.map(t => t.summary);
        const inferred = [];
        if (type === '设备故障') { inferred.push('客户设备故障大概率与断网/硬件相关，需优先核实离线设备与维修工单状态'); if (classify.sysRepeat) inferred.push('系统核验存在 30 天内同类工单，符合重复投诉升级条件'); }
        if (type === '补货异常') inferred.push('缺货可能与补货频次不足或在途配送延迟相关，需核实库存与催补记录');
        if (type === '商品质量') inferred.push('需先核实订单与生产日期方可进入理赔流程；赔付金额超过客服权限需人工审批');
        if (type === '退款异常') inferred.push('需核实订单开门记录判断是否未出货扣款');
        const toVerify = [...(SOPS[type] ? SOPS[type].verify : []), ...missing.map(m => '缺少关键信息：' + m)];
        const actions = [];
        if (type === '设备故障') actions.push('创建设备故障工单并带出货架编码', '核实上次维修反馈与当前维修计划', classify.sysRepeat ? '按 SOP-ESC-001 创建督办任务并由主管闭环回访' : '向客户告知已确认的核查进度');
        if (type === '补货异常') actions.push('对在途/最近补货单发起催办', '按点位核实排面与库存后提交补货需求', '约定补货时间并回访确认');
        if (type === '商品质量') actions.push('核实订单与生产日期（待客户提供凭证）', '客服权限内可先原路退款 ≤¥200', '超权限赔付提交人工审批');
        if (type === '退款异常') actions.push('核实订单开门记录与退款状态', '未出货扣款直接原路退款并答复到账时间');
        if (!actions.length) actions.push('转人工核实客户具体诉求');
        const replyMap = {
          '设备故障': '您好，非常抱歉给您带来不便。我们已核实您名下设备状态并同步设备运维，会加急处理${cls}，处理结果将第一时间反馈您。',
          '补货异常': '您好，非常抱歉货架缺货影响使用。我们已核查补货记录并向补货运营发起催办，将优先安排补货，预计补货后会及时告知您。',
          '商品质量': '您好，非常抱歉给您带来不好的体验。为快速处理，麻烦您提供订单编号和商品生产日期照片，核实后我们将立即为您办理退款，如涉及赔付会有专人跟进。',
          '退款异常': '您好，我们已核实您的订单与扣款记录，如确认未出货将立即为您原路退款，1-3 个工作日内到账。',
        };
        const reply = (replyMap[type] || '您好，您反馈的问题我们已记录，将尽快核实并回复您。').replace('${cls}', classify.sysRepeat ? '（已按重复投诉优先处理）' : '');
        // —— 可选：千问大模型增强叙述（仅当配置了 DASHSCOPE_API_KEY；失败自动降级） ——
        let llmUsed = false;
        if (process.env.DASHSCOPE_API_KEY) {
          try {
            const llmRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
              method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY },
              body: JSON.stringify({ model: 'qwen-plus', messages: [
                { role: 'system', content: '你是客服处理助手。基于给定的已核实事实与SOP，用中文输出简短的处理思路（3句话内，不得编造事实）。' },
                { role: 'user', content: JSON.stringify({ 投诉: text, 类型: type, 已核实事实: facts, SOP: sopMatch.map(s => s.name || '无') }) }] , temperature: 0.3 }),
              signal: AbortSignal.timeout(15000),
            });
            if (llmRes.ok) { const j = await llmRes.json(); if (j.choices && j.choices[0]) { classify.llmNote = j.choices[0].message.content; llmUsed = true; } }
          } catch {}
        }
        return ok(res, { mode: LLM_MODE(), llmUsed, classify, tools, sopMatch, plan: { facts, inferred, toVerify, actions, reply }, customer: cust ? { id: cust.id, name: cust.name } : null });
      }

      // ---- AI 工单预填：识别诉求后返回可直接预填的工单字段（全部允许人工修改） ----
      if (p === '/api/ai/prefill' && req.method === 'POST') {
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        const custId = Number(body.customer_id || 0);
        if (!text) return bad(res, 400, '请输入客户问题');
        const isQual = /过期|变质|异物|发霉|质量|坏掉|破损|发霉/.test(text);
        const isRep = /补货|没货|缺货|空了|断货|没有人来补/.test(text);
        const isDev = /断网|离线|用不了|不能用|故障|维修|重启|开不了|机器坏|坏了/.test(text);
        const isRef = /退款|退钱|扣了钱|多扣|退回|扣款/.test(text);
        const isTheft = /偷|盗|没付钱|跑单|白拿|拿走|不付/.test(text);  // 不文明购物/疑似偷盗
        const type = isTheft ? '不文明购物' : isQual ? '商品质量' : isDev && !isQual ? '设备故障' : isRep ? '补货异常' : isRef ? '退款异常' : '其他咨询';
        const catMap = {
          '商品质量': { path: '货架运营 > 商品质量 > 商品过期', risk: '投诉', urgency: '紧急' },
          '不文明购物': { path: '客诉售后 > 售后 > 商品仅退款', risk: '投诉', urgency: '紧急' },
          '设备故障': { path: '货架运营 > 设备断网 > 货架频繁断网', risk: '咨询', urgency: '一般' },
          '补货异常': { path: '货架运营 > 补货缺货 > 催补货未响应', risk: '咨询', urgency: '一般' },
          '退款异常': { path: '客诉售后 > 售后 > 退款退货申请', risk: '投诉', urgency: '一般' },
          '其他咨询': { path: '客诉售后 > 客诉 > 处理时效投诉', risk: '咨询', urgency: '一般' },
        };
        let cust = null, shelves = [], recentOrder = null;
        if (custId) {
          try { cust = (await sb('GET', 'customers', { select: '*', filters: [['id', 'eq.' + custId]] }))[0] || null; } catch {}
          try { shelves = await sb('GET', 'shelves', { select: 'code,shelf_id,name', filters: [['customer_id', 'eq.' + custId]] }); } catch {}
          try { const trs = await sb('GET', 'trades', { select: 'order_no,code,open_time,amount,status', filters: [['customer_id', 'eq.' + custId]], order: 'id.desc', limit: 3 }); recentOrder = trs[0] || null; } catch {}
        }
        const angry = /投诉|曝光|工商|12315|媒体|举报|差评/.test(text);
        const pre = catMap[type];
        // 质量类：提示需查订单前后视频定位（对应剔时表痛点）
        const needVideo = isQual || isTheft;
        return ok(res, {
          type, prefill: {
            cat_path: pre.path, risk: angry ? '投诉' : pre.risk, urgency: pre.urgency,
            shelf_code: shelves[0] ? shelves[0].code : '', shelf_id: shelves[0] ? shelves[0].shelf_id : '',
            demand: text.slice(0, 120),
          },
          editable: true,  // 所有字段允许人工修改
          hints: {
            needVideo,
            videoNote: needVideo ? '质量/疑似偷盗类：需调取订单前后视频核对商品情况（当前为人工翻看，平均每单 15-25 分钟）' : null,
            order: recentOrder ? { no: recentOrder.order_no, code: recentOrder.code, open_time: recentOrder.open_time, amount: recentOrder.amount } : null,
            missing: isQual && !/订单|买的/.test(text) ? ['订单编号'] : [],
          },
          mode: LLM_MODE(),
        });
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
