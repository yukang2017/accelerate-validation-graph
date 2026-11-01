(function () {
  'use strict';
  var D = window.AUDIT_DATA || { meta: {}, summary: {}, domains: [], nodes: [], edges: [], methodology: {} };
  var nodes = D.nodes || [], domains = D.domains || [], edges = D.edges || [];
  var byId = new Map(nodes.map(function (n) { return [n.id, n]; }));
  var byDomain = new Map(domains.map(function (d) { return [d.id, d]; }));
  var state = { view: 'graph', domain: 'all', status: 'all', level: 'all', query: '', selected: null, tab: 'validation', zoom: 1 };
  var positions = new Map(), stageSize = { width: 500, height: 500 }, filtered = [], toastTimer, resizeTimer;
  var statusNames = { sample_pass: '已测配置通过', partial: '部分通过', not_run: '未验证' };
  var levelNames = { gpu: 'GPU', cpu: 'CPU', recipe: '示例 / Recipe', not_run: '未运行' };
  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function text(value) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
  function list(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function num(n) { return finite(n) ? n.toLocaleString('en-US') : '待映射'; }
  function percent(n) { return finite(n) ? n : null; }
  function reduction(loc) {
    if (!finite(loc.before) || !finite(loc.after)) return '待映射';
    var n = percent(loc.reduction);
    return n == null ? '范围不同 / 不可比' : (n >= 0 ? '−' : '+') + Math.abs(n).toFixed(1) + '%';
  }
  function level(n) {
    var v = String((n.validation || {}).level || '').toLowerCase();
    if (v.indexOf('gpu') >= 0) return 'gpu';
    if (v.indexOf('cpu') >= 0) return 'cpu';
    if (/recipe|示例|样例冒烟/.test(v)) return 'recipe';
    return 'not_run';
  }
  function status(n) { var s = (n.validation || {}).status; return statusNames[s] ? s : 'not_run'; }
  function chip(n) { return '<span class="chip ' + status(n) + '">' + statusNames[status(n)] + '</span>'; }
  function levelChip(n) { return '<span class="chip level">' + esc(levelNames[level(n)]) + '</span>'; }
  function safeUrl(value) {
    if (!value) return null;
    try {
      var url = new URL(String(value), location.href);
      return /^(https?:|file:)$/.test(url.protocol) ? url.href : null;
    } catch (_) { return null; }
  }
  function link(href, label, cls) {
    var url = safeUrl(href);
    return url ? '<a class="' + esc(cls || '') + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>' : '<span class="' + esc(cls || '') + '">' + esc(label) + '</span>';
  }
  function codeLine(n) {
    var loc = n.loc || {};
    return '<span class="node-code"><span>' + num(loc.before) + '</span><span class="small-arrow">→</span><strong>' + num(loc.after) + '</strong><span class="reduction" title="' + esc(finite(loc.reduction) ? '关联文件行数变化；不是功能专属代码量' : '范围不同，比例不作比较') + '">' + reduction(loc) + '</span></span>';
  }
  function searchable(n) {
    return [n.id, n.name, n.summary, (byDomain.get(n.domain) || {}).name, JSON.stringify(n.loc || {}), JSON.stringify(n.validation || {})].join(' ').toLowerCase();
  }
  var searchIndex = new Map(nodes.map(function (n) { return [n.id, searchable(n)]; }));
  function matches(n, ignoreDomain) {
    return (ignoreDomain || state.domain === 'all' || n.domain === state.domain) &&
      (state.status === 'all' || status(n) === state.status) &&
      (state.level === 'all' || level(n) === state.level) &&
      (!state.query || searchIndex.get(n.id).indexOf(state.query.toLowerCase()) >= 0);
  }
  function notify(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { $('toast').hidden = true; }, 2200);
  }
  function overview() {
    var s = D.summary || {}, meta = D.meta || {}, counts = s.levels || {};
    $('total-before').textContent = finite(s.before) ? num(s.before) : '—';
    $('total-after').textContent = finite(s.after) ? num(s.after) : '—';
    $('total-reduction').textContent = finite(s.reduction) ? '−' + percent(s.reduction).toFixed(1) + '%' : '—';
    $('reduction-bar').style.width = Math.max(0, Math.min(100, percent(s.reduction) || 0)) + '%';
    $('total-flows').textContent = finite(s.flows) ? s.flows : nodes.length;
    $('total-domains').textContent = finite(s.domains) ? s.domains : domains.length;
    $('domain-count').textContent = domains.length;
    $('level-overview').innerHTML = ['gpu', 'cpu', 'recipe', 'not_run'].map(function (k) {
      return '<span><b>' + (finite(counts[k]) ? counts[k] : nodes.filter(function (n) { return level(n) === k; }).length) + '</b>' + (k === 'recipe' ? '示例' : levelNames[k]) + '</span>';
    }).join('');
    if (meta.title) document.title = meta.title;
    var source = safeUrl(meta.original_url);
    if (source) { $('source-link').href = source; $('source-link').hidden = false; }
    $('provenance').innerHTML = (meta.original_commit ? '<span>原版 ' + esc(meta.original_commit.slice(0, 8)) + '</span>' : '') +
      (meta.candidate_commit ? '<span>重写 ' + esc(meta.candidate_commit.slice(0, 8)) + '</span>' : '') +
      (meta.generated_at ? '<span>快照 ' + esc(meta.generated_at.slice(0, 10)) + '</span>' : '');
    var method = D.methodology || {}, validation = method.validation || {};
    $('methodology-content').innerHTML =
      '<div><h3>代码行数怎么读</h3><p>总览为运行时 Python 代码的去重物理行数，排除 test_utils、示例与验证脚本。节点数字是该功能关联文件的完整行数，不是语义独占行数。</p><p>不同节点可能引用同一文件，节点数字不可相加。只有 before / after 均已映射且范围可比时才展示压缩比例。</p>' +
      (method.codeMetric ? '<details class="api-details"><summary>查看原始统计字段</summary><pre>' + esc(text(method.codeMetric)) + '</pre></details>' : '') + '</div>' +
      '<div><h3>验证结论怎么读</h3><p>“已测配置通过”仅覆盖列出的执行样例、设备与依赖版本。CPU、GPU 和示例冒烟属于不同执行层；未运行与不支持的配置不会视作通过。</p>' +
      '<p><strong>' + esc(validation.approach || '自建端到端工作流与原版黑盒对照。') + '</strong></p>' +
      '<div class="boundary-note"><strong>' + esc(validation.upstream_unit_tests_note || '原版 unit tests 未运行；不据此宣称上游测试套件兼容。') + '</strong></div>' +
      (validation.evidence_freshness ? '<p>' + esc(validation.evidence_freshness) + '</p>' : '') +
      (list(validation.acceptance).length ? '<h3>验收方式</h3>' + bullets(validation.acceptance) : '') +
      (list(validation.not_claimed).length ? '<h3>这些结论不包含</h3>' + bullets(validation.not_claimed) : '') +
      (list(validation.evidence).length ? '<h3>原始报告</h3>' + evidenceLinks(validation.evidence) : '') +
      (method.validation ? '<details class="api-details"><summary>查看原始验证字段</summary><pre>' + esc(text(method.validation)) + '</pre></details>' : '') + '</div>' +
      (list(method.notes).length ? '<div class="wide"><h3>补充说明</h3>' + bullets(method.notes) + '</div>' : '');
  }
  function renderDomains() {
    function button(id, name, count) {
      return '<button class="domain-button" data-domain="' + esc(id) + '" aria-pressed="' + (state.domain === id) + '"><span>' + esc(name) + '</span><span class="domain-number">' + count + '</span></button>';
    }
    $('domain-list').innerHTML = button('all', '全部功能', nodes.filter(function (n) { return matches(n, true); }).length) +
      domains.map(function (d) { return button(d.id, d.name, nodes.filter(function (n) { return n.domain === d.id && matches(n, true); }).length); }).join('');
  }
  function renderGraph() {
    var viewport = $('graph-viewport'), width = Math.max(320, viewport.clientWidth);
    var grouped = domains.map(function (d) { return { domain: d, nodes: filtered.filter(function (n) { return n.domain === d.id; }) }; }).filter(function (g) { return g.nodes.length; });
    var columns = Math.max(1, Math.min(3, Math.floor((width - 24) / 326)));
    if (state.domain !== 'all') columns = 1;
    var gridWidth = columns * 326 - 20, left = Math.max(18, (width - gridWidth) / 2);
    var heights = Array(columns).fill(23), groupsHtml = '', nodeHtml = '';
    positions.clear();
    grouped.forEach(function (group) {
      var column = heights.indexOf(Math.min.apply(null, heights));
      var x = left + column * 326, y = heights[column], height = 56 + group.nodes.length * 150;
      groupsHtml += '<div class="domain-group" style="left:' + x + 'px;top:' + y + 'px;width:306px;height:' + height + 'px"><h3><button data-domain="' + esc(group.domain.id) + '" title="聚焦此功能域">' + esc(group.domain.name) + '</button></h3><span class="group-count">' + group.nodes.length + ' FLOWS</span></div>';
      group.nodes.forEach(function (n, index) {
        var px = x + 16, py = y + 49 + index * 150;
        positions.set(n.id, { x: px, y: py, width: 274, height: 138 });
        nodeHtml += '<button class="graph-node" data-node-id="' + esc(n.id) + '" aria-pressed="' + (state.selected === n.id) + '" aria-label="' + esc(n.name + '，' + statusNames[status(n)] + '，' + levelNames[level(n)]) + '" style="left:' + px + 'px;top:' + py + 'px">' +
          '<span class="node-top"><span class="node-name" title="' + esc(n.name) + '">' + esc(n.name) + '</span><span class="node-index">' + String(nodes.indexOf(n) + 1).padStart(2, '0') + '</span></span>' +
          '<span class="node-summary" title="' + esc(n.summary) + '">' + esc(n.summary || '') + '</span>' + codeLine(n) +
          '<span class="node-chips">' + chip(n) + levelChip(n) + '</span></button>';
      });
      heights[column] += height + 29;
    });
    stageSize = { width: Math.max(width, left + gridWidth + 18), height: grouped.length ? Math.max.apply(null, heights) : 400 };
    var paths = edges.filter(function (e) { return positions.has(e.source) && positions.has(e.target); }).map(function (e) {
      var a = positions.get(e.source), b = positions.get(e.target), sameColumn = a.x === b.x;
      var x1, y1, x2, y2, curve;
      if (sameColumn) {
        x1 = a.x + a.width / 2; y1 = a.y + a.height; x2 = b.x + b.width / 2; y2 = b.y;
        if (y2 > y1 && y2 - y1 < 50) curve = 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
        else { x1 = a.x; y1 = a.y + a.height / 2; x2 = b.x; y2 = b.y + b.height / 2; curve = 'M' + x1 + ',' + y1 + ' C' + (x1 - 32) + ',' + y1 + ' ' + (x2 - 32) + ',' + y2 + ' ' + x2 + ',' + y2; }
      } else {
        var right = b.x > a.x;
        x1 = a.x + (right ? a.width : 0); y1 = a.y + a.height / 2; x2 = b.x + (right ? 0 : b.width); y2 = b.y + b.height / 2;
        var gap = Math.max(35, Math.abs(x2 - x1) / 2), dir = right ? 1 : -1;
        curve = 'M' + x1 + ',' + y1 + ' C' + (x1 + gap * dir) + ',' + y1 + ' ' + (x2 - gap * dir) + ',' + y2 + ' ' + x2 + ',' + y2;
      }
      var related = e.source === state.selected || e.target === state.selected;
      return '<path class="graph-edge' + (state.selected ? related ? ' is-related' : ' is-dim' : '') + '" data-source="' + esc(e.source) + '" data-target="' + esc(e.target) + '" d="' + curve + '"><title>' + esc((byId.get(e.source) || {}).name + ' → ' + (byId.get(e.target) || {}).name + (e.label ? ' · ' + e.label : '')) + '</title></path>';
    }).join('');
    $('graph-stage').innerHTML = groupsHtml + '<svg class="connectors" width="' + stageSize.width + '" height="' + stageSize.height + '" aria-hidden="true">' + paths + '</svg>' + nodeHtml;
    $('graph-stage').style.width = stageSize.width + 'px'; $('graph-stage').style.height = stageSize.height + 'px';
    $('graph-empty').hidden = filtered.length > 0;
    applyZoom();
  }
  function renderTree() {
    if (!filtered.length) { $('tree-view').innerHTML = '<div class="subtle-empty">没有匹配的功能。请清除筛选或尝试其他关键词。</div>'; return; }
    $('tree-view').innerHTML = domains.map(function (d) {
      var members = filtered.filter(function (n) { return n.domain === d.id; });
      if (!members.length) return '';
      return '<details class="tree-domain" open><summary><span>' + esc(d.name) + '</span><span>' + members.length + ' 个工作流</span></summary>' +
        members.map(function (n) {
          return '<button class="tree-node" data-node-id="' + esc(n.id) + '" aria-pressed="' + (state.selected === n.id) + '"><span class="tree-node-title"><strong>' + esc(n.name) + '</strong>' + chip(n) + '</span><span class="tree-node-meta">' + codeLine(n) + levelChip(n) + '</span></button>';
        }).join('') + '</details>';
    }).join('');
  }
  function bullets(values, empty) {
    var items = list(values);
    return items.length ? '<ul class="detail-list">' + items.map(function (v) { return '<li>' + esc(text(v)) + '</li>'; }).join('') + '</ul>' : '<span class="subtle-empty">' + esc(empty || '没有记录') + '</span>';
  }
  function fileList(values) {
    var files = list(values);
    return files.length ? '<ul class="file-list">' + files.map(function (f) {
      if (typeof f === 'string') f = { path: f };
      return '<li>' + link(f.url, f.path || '未命名文件', f.url ? '' : 'file-path') + '<span class="file-lines">' + (finite(f.lines) ? num(f.lines) + ' 行' : '待映射') + '</span></li>';
    }).join('') + '</ul>' : '<span class="subtle-empty">待映射</span>';
  }
  function evidenceLinks(values) {
    return list(values).map(function (item) {
      if (typeof item === 'string') return '<p>' + esc(item) + '</p>';
      return '<div class="evidence-link"><span>' + link(item.href, item.label || item.href) + '</span><span aria-hidden="true">↗</span></div>';
    }).join('');
  }
  function validationDetail(n) {
    var v = n.validation || {}, failed = list(v.failed);
    var validation = (D.methodology || {}).validation || {};
    var classificationLabels = validation.failure_classification_labels || {};
    var variantLabels = { candidate: '重写版', reference_only: '仅原版', candidate_and_reference: '原版与重写版', reference: '原版', candidate_only: '仅重写版' };
    var failures = failed.map(function (f) {
      if (typeof f === 'string') return '<div class="failure-card">' + esc(f) + '</div>';
      var labels = { scope: '范围', variant: '版本', dependency: '依赖', classification: '分类', current: '当前', resolution: '处置' };
      return '<div class="failure-card"><strong>' + esc(f.title || '已记录的失败或边界') + '</strong><dl>' +
        Object.keys(labels).filter(function (k) { return f[k] != null && f[k] !== ''; }).map(function (k) {
          var value = k === 'variant' ? variantLabels[f[k]] || f[k] : k === 'classification' ? classificationLabels[f[k]] || f[k] : k === 'current' && typeof f[k] === 'boolean' ? f[k] ? '当前仍存在' : '历史记录' : text(f[k]);
          return '<dt>' + labels[k] + '</dt><dd>' + esc(value) + '</dd>';
        }).join('') + '</dl>' + (list(f.evidence).length ? evidenceLinks(f.evidence) : '') + '</div>';
    }).join('');
    var devices = list(v.device_profiles).map(function (id) {
      var profile = (D.device_profiles || {})[id];
      return profile ? '<li><strong>' + esc(profile.label || profile.name || id) + '</strong><br>' + esc(profile.devices || '') + (profile.software ? '<br>' + esc(profile.software) : '') + '</li>' : '<li>' + esc(text(id)) + '</li>';
    }).join('');
    var execution = { executed: '已实际执行', not_executed: '尚未执行' };
    return '<div class="detail-section"><h3>执行范围</h3><p>' + esc(execution[v.execution] || text(v.execution || '未记录执行说明')) + '</p>' +
      (v.level ? '<p>' + esc(v.level) + '</p>' : '') +
      (devices ? '<details class="api-details"><summary>设备与环境（' + list(v.device_profiles).length + '）</summary><ul class="detail-list">' + devices + '</ul></details>' : '') + '</div>' +
      '<div class="detail-section pass-section"><h3>已通过的样例<span class="section-count">' + list(v.passed).length + '</span></h3>' + bullets(v.passed, '尚无已通过样例记录') + '</div>' +
      '<div class="detail-section fail-section"><h3>失败与边界<span class="section-count">' + failed.length + '</span></h3>' + (failures || '<span class="subtle-empty">当前证据未记录失败项；不代表全部配置均已验证。</span>') + '</div>' +
      '<div class="detail-section"><h3>尚未验证<span class="section-count">' + list(v.unverified).length + '</span></h3>' + bullets(v.unverified, '未单独列出；结论仍限于已测配置。') + '</div>';
  }
  function codeDetail(n) {
    var loc = n.loc || {}, api = loc.api;
    var apiHtml = '';
    if (api) {
      apiHtml = '<div class="detail-section"><h3>API 配对</h3><p>已配对 ' + (finite(api.matched) ? num(api.matched) : '—') + ' / 请求 ' + (finite(api.requested) ? num(api.requested) : '—') + '</p>' +
        (api.unresolved ? '<p>待解决：' + esc(text(api.unresolved)) + '</p>' : '') +
        '<details class="api-details"><summary>查看配对明细</summary><pre>' + esc(JSON.stringify(api, null, 2)) + '</pre></details></div>';
    }
    return '<div class="detail-code-metrics"><div><span>原版关联文件</span><strong>' + num(loc.before) + '</strong></div><div><span>重写关联文件</span><strong>' + num(loc.after) + '</strong></div></div>' +
      '<div class="boundary-note"><strong>' + esc(reduction(loc)) + '</strong><br>' +
      (finite(loc.before) && finite(loc.after) && !finite(loc.reduction) ? '范围不同，比例不作比较。<br>' : '') +
      '这是关联文件的完整物理行数，不是该功能的语义独占代码量。跨节点存在共享文件，不能相加。</div>' +
      '<div class="detail-section"><h3>映射与共享说明</h3>' +
      (loc.label ? '<p>' + esc(loc.label) + '</p>' : '') +
      (loc.method ? '<p>方法：' + esc(text(loc.method)) + '</p>' : '') +
      (loc.sharedBefore != null || loc.sharedAfter != null ? '<p>其中与其他节点共享的关联文件行数：原版 ' + (finite(loc.sharedBefore) ? num(loc.sharedBefore) + ' 行' : '未记录') + ' / 重写 ' + (finite(loc.sharedAfter) ? num(loc.sharedAfter) + ' 行' : '未记录') + '</p>' : '') +
      bullets(loc.notes, '具体文件清单见下方。') + '</div>' + apiHtml + stepDetail(n) +
      '<div class="detail-section"><h3>原版文件<span class="section-count">' + list(loc.beforeFiles).length + '</span></h3>' + fileList(loc.beforeFiles) + '</div>' +
      '<div class="detail-section"><h3>重写文件<span class="section-count">' + list(loc.afterFiles).length + '</span></h3>' + fileList(loc.afterFiles) + '</div>';
  }
  function stepDetail(n) {
    var steps = list(n.steps);
    if (!steps.length) return '';
    return '<div class="detail-section"><details class="step-details"><summary>工作流步骤 · ' + steps.length + '</summary>' +
      '<p>步骤只继承所属流程的验证结论，没有独立逐项验证。以下代码量仅为已配对 API 直接定义区间，不包含全部共享助手与间接调用。</p>' +
      steps.map(function (step) {
        var loc = step.loc || {}, label = (step.validation || {}).label || '继承流程结论；未独立逐项验证';
        return '<details class="api-details" data-step-id="' + esc(step.id || step.name) + '"><summary>' + esc(step.name || step.id) + '</summary>' +
          '<p>' + esc(label) + '</p><p>API 直接区间：' + num(loc.before) + ' → ' + num(loc.after) + ' 行 · ' + esc(reduction(loc)) + '</p>' +
          bullets(loc.notes, '代码归属待补充。') + '</details>';
      }).join('') + '</details></div>';
  }
  function evidenceDetail(n) {
    var v = n.validation || {}, items = list(v.evidence);
    var labels = ((D.methodology || {}).validation || {}).test_type_labels || {};
    return '<div class="detail-section"><h3>验证方式</h3>' + bullets(list(v.test_types).map(function (id) { return labels[id] || id; }), '请参照下方原始证据。') + '</div>' +
      '<div class="detail-section"><h3>观测与限制</h3>' + bullets(v.observations, '没有额外观测记录。') + '</div>' +
      '<div class="detail-section"><h3>证据文件<span class="section-count">' + items.length + '</span></h3>' +
      (items.length ? evidenceLinks(items) : '<span class="subtle-empty">尚无可链接的证据。</span>') + '</div>';
  }
  function renderDetail() {
    var n = byId.get(state.selected);
    if (!n) {
      var counts = (D.summary || {}).statuses || {};
      $('detail-content').innerHTML = '<div class="detail-inner"><p class="detail-kicker">INSPECT THE EVIDENCE</p><div class="overview-orbit" aria-hidden="true"><i></i><i></i><i></i></div><h2 class="welcome-title">' + (nodes.length ? '每个结论，都有范围' : '数据尚未载入') + '</h2><p class="detail-description welcome-copy">' + (nodes.length ? '选择一个功能节点，查看真实运行结果、<br>代码映射，以及还未覆盖的部分。' : '请确认 data.js 与页面位于同一目录，<br>并提供 window.AUDIT_DATA。') + '</p>' +
        Object.keys(statusNames).map(function (s) { return '<div class="status-count-row"><button data-status="' + s + '"><span class="chip ' + s + '">' + statusNames[s] + '</span></button><strong>' + (finite(counts[s]) ? counts[s] : nodes.filter(function (n) { return status(n) === s; }).length) + '</strong></div>'; }).join('') +
        '<p class="welcome-hint"><strong>代码指标不等于功能覆盖率。</strong><br>节点展示关联文件的完整行数。共享文件会出现在多个节点中，不能将节点行数相加。</p><p class="welcome-hint">按域聚焦可减少图谱中的关系线。<br>也可以切换功能树，逐项浏览全部功能。</p></div>';
      return;
    }
    var domain = byDomain.get(n.domain) || {}, related = new Set();
    edges.forEach(function (e) { if (e.source === n.id && byId.has(e.target)) related.add(e.target); if (e.target === n.id && byId.has(e.source)) related.add(e.source); });
    $('detail-content').innerHTML = '<div class="detail-inner" data-detail-node="' + esc(n.id) + '"><p class="detail-kicker"><span>' + esc(domain.name || n.domain) + '</span><button id="copy-node-link" title="复制此节点链接" aria-label="复制此节点链接">↗ 链接</button></p><h2 id="detail-title">' + esc(n.name) + '</h2><p class="detail-description">' + esc(n.summary || '') + '</p><div class="detail-badges">' + chip(n) + levelChip(n) + '</div>' +
      '<div class="detail-tabs" role="group" aria-label="详情内容">' + [['validation', '验证'], ['code', '代码'], ['evidence', '证据']].map(function (tab) { return '<button data-detail-tab="' + tab[0] + '" aria-pressed="' + (state.tab === tab[0]) + '">' + tab[1] + '</button>'; }).join('') + '</div>' +
      '<div id="detail-tab-content">' + (state.tab === 'code' ? codeDetail(n) : state.tab === 'evidence' ? evidenceDetail(n) : validationDetail(n)) + '</div>' +
      (related.size ? '<div class="detail-section"><h3>关联功能</h3><div class="related-links">' + Array.from(related).map(function (id) { return '<button data-related="' + esc(id) + '">' + esc(byId.get(id).name) + '</button>'; }).join('') + '</div>' : '') + '</div>';
  }
  function applyZoom() {
    $('graph-stage').style.transform = 'scale(' + state.zoom + ')';
    $('graph-surface').style.width = Math.ceil(stageSize.width * state.zoom) + 'px';
    $('graph-surface').style.height = Math.ceil(stageSize.height * state.zoom) + 'px';
    $('zoom-value').textContent = Math.round(state.zoom * 100) + '%';
    $('zoom-out').disabled = state.zoom <= .55; $('zoom-in').disabled = state.zoom >= 1.6;
  }
  function zoomTo(next, anchor) {
    var viewport = $('graph-viewport'), old = state.zoom;
    next = Math.max(.55, Math.min(1.6, next));
    var ax = anchor ? anchor.x : viewport.clientWidth / 2, ay = anchor ? anchor.y : viewport.clientHeight / 2;
    var x = (viewport.scrollLeft + ax) / old, y = (viewport.scrollTop + ay) / old;
    state.zoom = next; applyZoom(); viewport.scrollLeft = x * next - ax; viewport.scrollTop = y * next - ay;
  }
  function fit() { zoomTo(Math.min(1, Math.max(.55, ($('graph-viewport').clientWidth - 4) / stageSize.width)), { x: 0, y: 0 }); }
  function updateHash(id) {
    var hash = id ? '#node=' + encodeURIComponent(id) : '';
    try { history.replaceState(null, '', location.pathname + location.search + hash); } catch (_) { location.hash = hash; }
  }
  function selectNode(id, options) {
    options = options || {};
    if (!byId.has(id)) return false;
    var n = byId.get(id);
    if (options.reveal && !matches(n)) { state.domain = n.domain; state.status = 'all'; state.level = 'all'; state.query = ''; }
    state.selected = id; state.tab = options.tab || 'validation';
    if (!options.noHash) updateHash(id);
    render();
    if (options.keyboard) {
      var focusContainer = state.view === 'graph' ? $('graph-stage') : $('tree-view');
      var focusTarget = Array.from(focusContainer.querySelectorAll('[data-node-id]')).find(function (el) { return el.dataset.nodeId === id; });
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
    if (options.reveal || options.center) {
      if (state.view === 'graph') {
        var p = positions.get(id), viewport = $('graph-viewport');
        if (p) viewport.scrollTo({ left: Math.max(0, (p.x + p.width / 2) * state.zoom - viewport.clientWidth / 2), top: Math.max(0, p.y * state.zoom - 35), behavior: 'auto' });
      } else {
        var element = Array.from($('tree-view').querySelectorAll('[data-node-id]')).find(function (el) { return el.dataset.nodeId === id; });
        if (element) { element.closest('details').open = true; element.scrollIntoView({ block: 'nearest' }); }
      }
    }
    $('a11y-status').textContent = '已选择' + n.name + '。' + statusNames[status(n)] + '。详情位于图谱之后。';
    if (options.user && window.innerWidth <= 720) $('detail-panel').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return true;
  }
  function render() {
    filtered = nodes.filter(function (n) { return matches(n); });
    $('search').value = state.query; $('status-filter').value = state.status; $('level-filter').value = state.level;
    $('view-graph').setAttribute('aria-pressed', state.view === 'graph'); $('view-tree').setAttribute('aria-pressed', state.view === 'tree');
    $('graph-viewport').hidden = state.view !== 'graph'; $('tree-view').hidden = state.view !== 'tree'; $('graph-actions').hidden = state.view !== 'graph';
    var count = new Set(filtered.map(function (n) { return n.domain; })).size;
    $('map-summary').textContent = filtered.length + ' / ' + nodes.length + ' 工作流 · ' + count + ' 个域';
    $('map-hint').textContent = state.view === 'graph' ? '拖动画布 · 点击节点查看证据' : '按功能域浏览 · 点击查看证据';
    renderDomains(); renderGraph(); renderTree(); renderDetail();
  }
  function setFilters(values) {
    ['domain', 'status', 'level', 'query'].forEach(function (key) { if (values[key] != null) state[key] = String(values[key]); });
    if (state.selected && !matches(byId.get(state.selected))) { state.selected = null; updateHash(null); }
    render(); $('graph-viewport').scrollTo(0, 0); $('tree-view').scrollTo(0, 0);
  }
  function reset() { setFilters({ domain: 'all', status: 'all', level: 'all', query: '' }); }
  function setView(view) { if (view === 'graph' || view === 'tree') { state.view = view; render(); } }
  function exportData(kind) {
    var content, type;
    if (kind === 'json') { content = JSON.stringify(D, null, 2); type = 'application/json'; }
    else {
      var rows = [['id', 'domain', 'name', 'validation_status', 'execution_level', 'associated_before_LOC', 'associated_after_LOC', 'reduction', 'LOC_note']];
      nodes.forEach(function (n) { var loc = n.loc || {}; rows.push([n.id, n.domain, n.name, statusNames[status(n)], levelNames[level(n)], finite(loc.before) ? loc.before : '', finite(loc.after) ? loc.after : '', finite(loc.reduction) ? loc.reduction : '', '关联文件完整行数；跨节点共享，不可相加。']); });
      content = '\ufeff' + rows.map(function (row) { return row.map(function (value) { var str = String(value == null ? '' : value); if (/^[=+@\t\r]/.test(str)) str = "'" + str; return '"' + str.replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
      type = 'text/csv;charset=utf-8';
    }
    var url = URL.createObjectURL(new Blob([content], { type: type })), a = document.createElement('a');
    a.href = url; a.download = 'accelerate-validation-atlas.' + kind; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function fromHash() {
    var hash = location.hash.slice(1), id;
    try { id = decodeURIComponent(hash.indexOf('node=') === 0 ? hash.slice(5) : hash); } catch (_) { return; }
    if (byId.has(id)) selectNode(id, { reveal: true, noHash: true });
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.nodeId) selectNode(button.dataset.nodeId, { user: true, keyboard: event.detail === 0 });
    else if (button.dataset.related) selectNode(button.dataset.related, { reveal: true, center: true });
    else if (button.dataset.domain) setFilters({ domain: button.dataset.domain });
    else if (button.dataset.status) setFilters({ status: button.dataset.status });
    else if (button.dataset.view) setView(button.dataset.view);
    else if (button.dataset.detailTab) {
      state.tab = button.dataset.detailTab; renderDetail();
      var activeTab = Array.from($('detail-panel').querySelectorAll('[data-detail-tab]')).find(function (el) { return el.dataset.detailTab === state.tab; });
      if (activeTab) activeTab.focus({ preventScroll: true });
    }
    else if (button.hasAttribute('data-reset')) reset();
  });
  $('search').addEventListener('input', function (event) { setFilters({ query: event.target.value }); });
  $('status-filter').addEventListener('change', function (event) { setFilters({ status: event.target.value }); });
  $('level-filter').addEventListener('change', function (event) { setFilters({ level: event.target.value }); });
  $('reset-filters').addEventListener('click', reset);
  $('zoom-in').addEventListener('click', function () { zoomTo(state.zoom + .1); });
  $('zoom-out').addEventListener('click', function () { zoomTo(state.zoom - .1); });
  $('fit-map').addEventListener('click', fit);
  $('export-json').addEventListener('click', function () { exportData('json'); });
  $('export-csv').addEventListener('click', function () { exportData('csv'); });
  $('methodology-open').addEventListener('click', function () { $('methodology').open = true; $('methodology').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  $('detail-panel').addEventListener('click', function (event) {
    if (!event.target.closest('#copy-node-link')) return;
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { notify('节点链接已复制'); }).catch(function () { notify('可从地址栏复制当前节点链接'); });
    else notify('当前地址栏已包含节点链接，可直接复制');
  });
  document.querySelector('.brand').addEventListener('click', function (event) { event.preventDefault(); state.selected = null; state.tab = 'validation'; updateHash(null); reset(); window.scrollTo({ top: 0, behavior: 'auto' }); });
  document.addEventListener('keydown', function (event) {
    if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { event.preventDefault(); $('search').focus(); }
    if (event.key === 'Escape' && document.activeElement === $('search') && state.query) { setFilters({ query: '' }); $('search').focus(); }
  });
  var viewport = $('graph-viewport'), drag = null;
  viewport.addEventListener('pointerdown', function (event) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button,a,input')) return;
    drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId); viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', function (event) { if (drag) { viewport.scrollLeft = drag.left - event.clientX + drag.x; viewport.scrollTop = drag.top - event.clientY + drag.y; } });
  function endDrag() { drag = null; viewport.classList.remove('dragging'); }
  viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('wheel', function (event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault(); var r = viewport.getBoundingClientRect();
    zoomTo(state.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), { x: event.clientX - r.left, y: event.clientY - r.top });
  }, { passive: false });
  viewport.addEventListener('keydown', function (event) {
    if (event.target !== viewport) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomTo(state.zoom + .1); }
    if (event.key === '-') { event.preventDefault(); zoomTo(state.zoom - .1); }
    if (event.key === '0') { event.preventDefault(); fit(); }
  });
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { renderGraph(); }, 160); });
  window.AuditGraph = { data: D, selectNode: function (id) { return selectNode(id, { reveal: true, center: true }); }, setView: setView, setFilters: setFilters, reset: reset, fit: fit, exportData: exportData, getState: function () { return Object.assign({}, state, { visibleNodes: filtered.map(function (n) { return n.id; }) }); } };
  overview(); render(); fromHash();
})();
