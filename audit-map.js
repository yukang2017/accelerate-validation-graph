/* Evidence overlay for the original LMA viewer. No graph geometry is replaced. */
(() => {
  "use strict";
  const data = globalThis.AUDIT_DATA;
  const metrics = globalThis.AUDIT_CODE_METRICS;
  const view = globalThis.LMACapabilityView;
  if (!data || !metrics || !view || !globalThis.LMAFunctionTree) {
    globalThis.AccelerateAuditMap = {ready:false,error:"Load the original LMA viewer, map.js, AUDIT_DATA and AUDIT_CODE_METRICS before audit-map.js."};
    return;
  }
  const $ = id => document.getElementById(id);
  const original = JSON.parse($("lma-data").textContent).plan;
  const source = JSON.parse($("accelerate-map-data").textContent);
  const originalIds = globalThis.AUDIT_ID_MAP || {};
  const nativeNodes = new Map(globalThis.LMAFunctionTree.buildNodes(original.capabilities).map(n => [n.id,n]));
  const metricNodes = new Map(metrics.nodes.map(n => [n.id,n]));
  const records = new Map(), aliases = new Map(), errors = [];
  const statusLabels = {sample_pass:"已测配置通过",partial:"部分通过",not_run:"未验证"};
  const levelLabels = {gpu:"GPU",cpu:"CPU",recipe:"示例",not_run:"未运行",mixed:"多执行层"};
  const scope = (data.methodology || {}).validation || {};
  const fmt = value => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "待映射";
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const arr = value => Array.isArray(value) ? value : value == null ? [] : [value];
  const str = value => typeof value === "string" ? value : JSON.stringify(value);
  const el = (tag,text,cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const setText = (node,text) => { if (node && node.textContent !== text) node.textContent = text; };
  const safeURL = value => {
    if (!value) return null;
    try { const url = new URL(value,location.href); return ["file:","http:","https:"].includes(url.protocol) ? url.href : null; }
    catch (_) { return null; }
  };
  const anchor = (text,href) => {
    const url = safeURL(href);
    const node = el(url ? "a" : "span",text);
    if (url) { node.href = url; node.target = "_blank"; node.rel = "noopener noreferrer"; }
    return node;
  };
  const executionLevel = validation => {
    const text = String(validation?.level || "").toLowerCase();
    return text.includes("gpu") ? "gpu" : text.includes("cpu") ? "cpu" : /recipe|示例/.test(text) ? "recipe" : "not_run";
  };
  const addRecord = record => {
    records.set(record.id,record);
    aliases.set(record.id,record.id);
    if (record.key) aliases.set(record.key,record.id);
    if (record.kind === "flow") aliases.set(record.flow.id,record.id);
  };
  // Original import mapping and embedded IDs are authoritative. No labels,
  // hashes or native IDs are guessed by this adapter.
  for (const audit of data.nodes) {
    const flow = source.flows.find(f => f.capability_id === originalIds["flow:"+audit.id]);
    if (!flow || !nativeNodes.has(flow.capability_id)) { errors.push("Unmapped original flow: " + audit.id); continue; }
    const record = {id:flow.capability_id,key:"flow:"+audit.id,kind:"flow",flow:audit,flows:[audit],loc:audit.loc,validation:audit.validation};
    addRecord(record);
    flow.steps.forEach((step,index) => {
      const key = "step:" + audit.id + ":" + String(index + 1).padStart(2,"0");
      const metric = metricNodes.get(key), native = nativeNodes.get(step.display_id);
      if (!metric || !native || native.owner !== flow.capability_id || originalIds[key] !== step.display_id) { errors.push("Unmapped original step: " + step.display_id); return; }
      addRecord({id:step.display_id,key,kind:"step",flow:audit,flows:[audit],owner:flow.capability_id,loc:metric.loc,validation:audit.validation});
    });
  }
  function aggregate(flows) {
    const counts = {sample_pass:0,partial:0,not_run:0};
    flows.forEach(n => counts[n.validation.status in counts ? n.validation.status : "not_run"]++);
    const status = !flows.length || counts.not_run === flows.length ? "not_run" : counts.sample_pass === flows.length ? "sample_pass" : "partial";
    return {status,counts,level:"汇总",execution:flows.some(n=>n.validation.execution==="executed")?"executed":"not_executed"};
  }
  for (const domain of data.domains) {
    const cap = nativeNodes.get(originalIds["domain:"+domain.id]);
    const loc = metricNodes.get("domain:"+domain.id)?.loc;
    if (!cap || !loc) { errors.push("Unmapped original domain: " + domain.name); continue; }
    const flows = data.nodes.filter(n=>n.domain===domain.id);
    addRecord({id:cap.id,key:"domain:"+domain.id,kind:"domain",flows,loc,validation:aggregate(flows)});
  }
  const root = nativeNodes.get(originalIds["$root"]);
  if (root) addRecord({id:root.id,key:"$root",kind:"root",flows:data.nodes,loc:{...metrics.runtimeTotal,label:"运行时 Python 物理行",notes:["排除 test_utils、示例、基准及验证脚本；这是去重后的运行时总体口径。"]},validation:aggregate(data.nodes)});
  const state = {tab:"validation",status:"all",level:"all",active:null,refreshes:0};
  const fileLinks = {before:new Map(),after:new Map()};
  data.nodes.forEach(n=>["before","after"].forEach(side=>arr(n.loc?.[side+"Files"]).forEach(f=>{if(f.url)fileLinks[side].set(f.path,f.url);})));
  document.body.classList.add("audit-map");
  setText($("project-name"),"Accelerate · 原始功能图与重构验证");
  setText($("project-goal"),"保留原来的功能层级与关系图，在同一节点上对照重写前后的代码规模、实际验证结果与未覆盖范围。");
  setText(document.querySelector(".local-badge"),"ORIGINAL GRAPH · EVIDENCE OVERLAY");
  setText(document.querySelector(".trust-note p"),"原 LMA 图谱渲染器与交互保持不变。连线描述功能关系，不表示组合路径已验证。步骤继承所属流程的结论，不是独立验证结果。");
  setText($("snapshot-label"),"原版 " + data.meta.original_commit.slice(0,8) + " → 重写 " + data.meta.candidate_commit.slice(0,8) + " · 固定证据快照");
  const provenance = document.querySelector(".map-provenance");
  if (provenance) {
    provenance.replaceChildren(el("span","原图结构保持不变","map-static-badge"),
      anchor(data.meta.publication_audience==="public"?"原版源码 ↗":"原始功能图 ↗",data.meta.original_url),
      el("span","原版 "+data.meta.original_commit.slice(0,8)+" · 重写 "+data.meta.candidate_commit.slice(0,8)));
    const actions = el("div",null,"audit-exports");
    ["JSON","CSV"].forEach(kind=>{const b=el("button","导出 "+kind,"audit-button");b.type="button";b.dataset.auditExport=kind.toLowerCase();actions.append(b);});
    provenance.append(actions);
  }
  const stats = document.querySelector(".map-stats");
  if (stats) {
    stats.replaceChildren();
    const s=data.summary;
    for (const [label,value,caption] of [
      ["运行时 Python 代码",fmt(s.before)+" → "+fmt(s.after),"排除 test_utils、示例与验证脚本"],
      ["运行时代码减少","−"+Number(s.reduction).toFixed(1)+"%","固定提交；不是全仓库代码规模"],
      ["原图功能结构","10 / 37 / 104","领域 / 流程 / 步骤；根节点另计"],
      ["流程验证结果",s.statuses.sample_pass+" / "+s.statuses.partial+" / "+s.statuses.not_run,"已测配置通过 / 部分通过 / 未验证"]
    ]) {const card=el("div",null,"map-stat");card.append(el("div",label,"map-stat-label"),el("div",value,"map-stat-number"),el("p",caption,"map-stat-caption"));stats.append(card);}
  }
  const toolbar=el("div",null,"audit-toolbar");toolbar.id="audit-toolbar";
  function selectControl(id,label,options) {
    const wrapper=el("label",label),select=el("select");select.id=id;
    options.forEach(([value,text])=>{const option=el("option",text);option.value=value;select.append(option);});
    wrapper.append(select);return wrapper;
  }
  toolbar.append(selectControl("audit-status-filter","验证高亮",Object.entries({all:"全部结果",...statusLabels})),
    selectControl("audit-level-filter","执行层",Object.entries({all:"全部执行层",gpu:"GPU",cpu:"CPU",recipe:"示例",not_run:"未运行"})),
    el("span","仅淡化其他节点，保留原图关系","audit-filter-help"));
  document.querySelector(".function-controls").after(toolbar);
  const legend=el("div",null,"audit-legend");
  legend.append(el("span","节点数字：关联文件完整行数；步骤数字：所引 API 区间。跨节点共享，不可相加。"));
  toolbar.after(legend);
  const panel=el("section",null,"audit-detail");panel.id="audit-detail";panel.setAttribute("aria-label","重构与验证详情");
  $("detail-content").before(panel);
  const sourcePanel=$("map-source-panel");
  if(sourcePanel){const disclosure=el("details",null,"audit-original-source");disclosure.id="audit-original-source";disclosure.append(el("summary","原版源码索引（原图保留）"));sourcePanel.before(disclosure);disclosure.append(sourcePanel);}
  function pill(record) {
    const label=statusLabels[record.validation.status]||statusLabels.not_run;
    const suffix=record.kind==="step"?" · 继承":record.kind==="domain"||record.kind==="root"?" · 汇总":"";
    const node=el("span",label+suffix,"audit-status "+record.validation.status);
    node.title=record.kind==="step"?"继承所属流程结论；该步骤未独立验证":"仅代表已记录的配置与样例，不是全部功能等价证明";
    return node;
  }
  function reduction(loc) {
    if(!finite(loc?.before)||!finite(loc?.after))return"待映射";
    if(!finite(loc.reduction))return"范围不同";
    return (loc.reduction>=0?"−":"+")+Math.abs(loc.reduction).toFixed(1)+"%";
  }
  function recordLevel(record) {
    const levels=[...new Set(record.flows.map(n=>executionLevel(n.validation)))];
    return levels.length===1?levels[0]:"mixed";
  }
  function matches(record) {
    return record.flows.some(n=>(state.status==="all"||n.validation.status===state.status)&&(state.level==="all"||executionLevel(n.validation)===state.level));
  }
  function decorateTree() {
    for(const row of $("capability-tree").querySelectorAll(".node-row[data-capability-id]")) {
      const record=records.get(row.dataset.capabilityId);if(!record)continue;
      row.dataset.auditKind=record.kind;row.dataset.auditKey=record.key;row.dataset.auditStatus=record.validation.status;
      row.classList.toggle("audit-muted",!matches(record));
      let overlay=row.querySelector(".audit-node-overlay");
      if(!overlay) {
        overlay=el("div",null,"audit-node-overlay");
        const loc=record.loc||{},numbers=el("div",null,"audit-node-loc");
        numbers.append(el("span",fmt(loc.before)),el("span","→","audit-arrow"),el("strong",fmt(loc.after)),el("span",reduction(loc),"audit-node-reduction"));
        numbers.title=(record.kind==="step"?"所引 API 直接定义区间，非功能独占代码":"关联文件完整行数，跨节点共享不可相加")+(finite(loc.reduction)?"":"；范围不同，比例不作比较");
        const badges=el("div",null,"audit-node-badges");
        badges.append(pill(record),el("span",record.kind==="step"?"非独立验证":levelLabels[recordLevel(record)],"audit-node-level"));
        overlay.append(numbers,badges);row.querySelector(".node-footer").append(overlay);
      }
    }
    const highlights=state.status!=="all"||state.level!=="all";
    for(const edge of $("capability-tree").querySelectorAll("path[data-source][data-target]")) {
      const a=records.get(edge.dataset.source),b=records.get(edge.dataset.target);
      edge.classList.toggle("audit-edge-muted",Boolean(highlights&&a&&b&&(!matches(a)||!matches(b))));
    }
    const summary=$("tree-map-summary"),current=summary.textContent;
    setText(summary,current.replaceAll("capabilities","模块").replaceAll("relationships","关系").replaceAll("visible nodes","可见节点").replaceAll("modules","模块").replaceAll("function details","功能步骤").replaceAll("matches","匹配"));
  }
  function appendList(parent,values,empty) {
    const items=arr(values);if(!items.length){parent.append(el("p",empty||"没有单独记录。","audit-empty"));return;}
    const ul=el("ul",null,"audit-list");items.forEach(v=>ul.append(el("li",str(v))));parent.append(ul);
  }
  function block(title) {const section=el("section",null,"audit-block");section.append(el("h3",title));return section;}
  function appendEvidence(parent,values) {
    arr(values).forEach(item=>{
      const row=el("div",null,"audit-evidence-link");
      row.append(typeof item==="string"?el("span",item):anchor(item.label||item.href,item.href));parent.append(row);
    });
  }
  function flowButton(flow) {
    const button=el("button",flow.name,"audit-flow-link");button.type="button";button.dataset.auditInspect=flow.id;
    const record=records.get(aliases.get(flow.id));if(record)button.append(pill(record));return button;
  }
  function validationContent(record) {
    const fragment=document.createDocumentFragment();
    if(record.kind==="root"||record.kind==="domain") {
      const overview=block("下属流程验证汇总");
      overview.append(el("p","按流程结论汇总，不是额外执行的领域级测试。已测配置通过不等于全部配置均通过。"));
      record.flows.forEach(flow=>overview.append(flowButton(flow)));fragment.append(overview);return fragment;
    }
    const v=record.validation,run=block("执行范围");
    run.append(el("p",(v.execution==="executed"?"已实际执行":"尚未执行")+" · "+(v.level||levelLabels[recordLevel(record)])));
    const testNames=scope.test_type_labels||{};
    appendList(run,arr(v.test_types).map(x=>testNames[x]||x),"未单列验证方式；参照证据。");
    if(arr(v.device_profiles).length){const detail=el("details");detail.append(el("summary","设备与环境"));arr(v.device_profiles).forEach(id=>{const profile=data.device_profiles?.[id];detail.append(el("p",profile?[profile.name||profile.label||id,profile.devices,profile.software].filter(Boolean).join(" · "):id));});run.append(detail);}
    fragment.append(run);
    const passed=block("已通过的样例");passed.classList.add("audit-pass");appendList(passed,v.passed,"尚无已通过样例记录。");fragment.append(passed);
    const failures=block("失败与边界");failures.classList.add("audit-fail");
    if(!arr(v.failed).length)failures.append(el("p","当前证据没有记录失败项；不代表所有配置均已验证。","audit-empty"));
    const variants={candidate:"重写版",candidate_and_reference:"原版与重写版",reference_only:"仅原版",reference:"原版"};
    arr(v.failed).forEach(f=>{
      if(typeof f==="string"){failures.append(el("p",f));return;}
      const card=el("article",null,"audit-failure");card.append(el("h4",f.title));
      [["范围",f.scope],["版本",variants[f.variant]||f.variant],["依赖",f.dependency],["分类",scope.failure_classification_labels?.[f.classification]||f.classification],["状态",f.current===true?"当前仍存在":f.current===false?"历史记录":f.current],["处置",f.resolution]].forEach(([label,value])=>{if(value!=null)card.append(el("p",label+"："+str(value)));});
      appendEvidence(card,f.evidence);failures.append(card);
    });fragment.append(failures);
    const unverified=block("尚未验证");appendList(unverified,v.unverified,"未单独列出；结论仍限于已测配置。");fragment.append(unverified);
    return fragment;
  }
  function filesContent(title,files,side,isStep) {
    const section=block(title+" · "+arr(files).length);
    if(!arr(files).length){section.append(el("p","待映射","audit-empty"));return section;}
    const list=el("ul",null,"audit-files");
    arr(files).forEach(f=>{
      let href=f.url||fileLinks[side].get(f.path);
      if(href&&arr(f.ranges).length){const url=new URL(href,location.href);url.hash="L"+f.ranges[0][0];href=url.href;}
      const li=el("li");li.append(anchor(f.path,href),el("span",fmt(f.lines)+(isStep?" 区间行":" 行")));
      if(arr(f.ranges).length)li.append(el("small","定义区间："+f.ranges.map(r=>r.join("–")).join("、")));list.append(li);
    });section.append(list);return section;
  }
  function codeContent(record) {
    const fragment=document.createDocumentFragment(),loc=record.loc||{},section=block(loc.label||"关联代码范围");
    section.append(el("div",fmt(loc.before)+" → "+fmt(loc.after)+" · "+reduction(loc),"audit-detail-loc"));
    const note=record.kind==="root"?"运行时 Python 物理行去重统计，排除 test_utils、示例与验证脚本。":record.kind==="step"?"仅为所引 API 直接定义区间，不是步骤完整实现或独占代码；验证继承所属流程。":record.kind==="domain"?"下属流程关联文件的并集统计，不是节点行数相加。跨领域仍有共享。":"关联文件的完整物理行数，不是该功能的语义独占代码量。跨节点共享，不能相加。";
    section.append(el("p",note,"audit-scope-note"));
    if(finite(loc.before)&&finite(loc.after)&&!finite(loc.reduction))section.append(el("p","范围不同，比例不作比较。","audit-scope-note"));
    appendList(section,loc.notes,"具体映射见文件和 API 明细。");
    if(finite(loc.sharedBefore)||finite(loc.sharedAfter))section.append(el("p","跨节点共享记录：原版 "+fmt(loc.sharedBefore)+" 行 / 重写 "+fmt(loc.sharedAfter)+" 行。"));
    fragment.append(section);
    if(loc.api){
      const api=block("API 直接定义配对");api.append(el("p","已配对 "+fmt(loc.api.matched)+" / "+fmt(loc.api.requested)+"；未匹配 "+fmt(loc.api.unresolved)));
      appendList(api,loc.api.notes,"同名配对不等于功能或接口等价证明。");
      const details=el("details");details.append(el("summary","原始配对与区间明细"),el("pre",JSON.stringify(loc.api,null,2)));api.append(details);fragment.append(api);
    }
    if(record.kind!=="root"){fragment.append(filesContent("原版文件",loc.beforeFiles,"before",record.kind==="step"),filesContent("重写文件",loc.afterFiles,"after",record.kind==="step"));}
    return fragment;
  }
  function evidenceContent(record) {
    const fragment=document.createDocumentFragment();
    if(record.kind==="root"||record.kind==="domain"){const section=block("按流程查看证据");record.flows.forEach(f=>section.append(flowButton(f)));appendEvidence(section,scope.evidence);fragment.append(section);return fragment;}
    const section=block("证据文件");appendEvidence(section,record.validation.evidence);
    if(!arr(record.validation.evidence).length)section.append(el("p","尚无可链接的证据。","audit-empty"));
    fragment.append(section);const observations=block("观测与限制");appendList(observations,record.validation.observations,"没有额外观测记录。");fragment.append(observations);return fragment;
  }
  function renderPanel() {
    const id=view.activeId(),record=records.get(id);if(!record)return;
    panel.dataset.auditNode=id;panel.dataset.auditKey=record.key;panel.replaceChildren();
    const badges=el("div",null,"audit-detail-badges");badges.append(pill(record),el("span",record.kind==="step"?"步骤验证继承":levelLabels[recordLevel(record)],"audit-node-level"));panel.append(badges);
    if(record.kind==="step"){const notice=el("div",null,"audit-step-note");notice.append(el("strong","非独立验证"),el("p","以下通过、失败和未测项均继承流程「"+record.flow.name+"」。不能据此认定该步骤已逐项独立测试。"));const button=el("button","查看所属流程","audit-button");button.dataset.auditInspect=record.owner;notice.append(button);panel.append(notice);}
    const tabs=el("div",null,"audit-tabs");tabs.setAttribute("role","group");tabs.setAttribute("aria-label","重构验证详情");
    [["validation","验证"],["code","代码"],["evidence","证据"]].forEach(([key,label])=>{const button=el("button",label);button.type="button";button.dataset.auditTab=key;button.setAttribute("aria-pressed",String(state.tab===key));tabs.append(button);});panel.append(tabs);
    const body=el("div",null,"audit-tab-content");body.append(state.tab==="code"?codeContent(record):state.tab==="evidence"?evidenceContent(record):validationContent(record));panel.append(body);
    for(const nativeBlock of $("detail-content").querySelectorAll(".detail-block")){
      if(["SOURCE FOOTPRINT","源码规模"].includes(nativeBlock.querySelector("h3")?.textContent))nativeBlock.classList.add("audit-native-footprint");
    }
  }
  const method=el("details",null,"audit-methodology");method.id="audit-methodology";method.append(el("summary","统计口径与验证边界"));
  const methodBody=el("div");methodBody.append(el("h3","代码口径"),el("p","总览为运行时 Python 代码；领域与流程为关联文件完整行数，步骤为所引 API 定义区间。节点内取并集，跨节点仍有共享，不能把节点行数或比例相加。"));
  appendList(methodBody,data.methodology?.notes);
  methodBody.append(el("h3","验证方式"),el("p",scope.approach||"自建端到端工作流与原版黑盒对照。"),el("strong",scope.upstream_unit_tests_note||"上游 unit tests 未运行。"),el("p",scope.evidence_freshness||"证据对应固定提交与已记录的执行配置。"));
  appendList(methodBody,scope.acceptance);methodBody.append(el("h3","不作出的声明"));appendList(methodBody,scope.not_claimed);appendEvidence(methodBody,scope.evidence);method.append(methodBody);document.querySelector("footer").before(method);
  let pending=false;
  function updateHash(id) {
    const record=records.get(id);if(!record)return;
    const key=record.kind==="flow"?record.flow.id:record.key;
    try{history.replaceState(null,"",location.pathname+location.search+"#node="+encodeURIComponent(key));}catch(_){}
  }
  function refresh() {
    state.refreshes++;decorateTree();
    const active=view.activeId();
    if(state.active!==active){state.active=active;state.tab="validation";updateHash(active);}
    renderPanel();
  }
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;refresh();});}
  // Native renderer replaces these direct children. Our overlays are deeper
  // descendants and the audit detail panel is a sibling, so our writes cannot
  // retrigger these observers. No subtree observer or polling is used.
  const treeObserver=new MutationObserver(schedule),detailObserver=new MutationObserver(schedule);
  treeObserver.observe($("capability-tree"),{childList:true});
  detailObserver.observe($("detail-content"),{childList:true});
  function inspect(id) {
    const native=aliases.get(id);if(!native)return false;
    if(records.get(native)?.kind==="step"&&view.viewMode()!=="tree")view.changeViewMode("tree");
    view.inspect(native);schedule();return true;
  }
  function readHash() {
    if(!location.hash.startsWith("#node="))return;
    try{inspect(decodeURIComponent(location.hash.slice(6)));}catch(_){}
  }
  function exportData(kind) {
    let content,type;
    if(kind==="json"){content=JSON.stringify(data,null,2);type="application/json";}
    else {
      const rows=[["flow_id","name","status","execution_level","before_LOC","after_LOC","reduction_percent","note"],...data.nodes.map(n=>[n.id,n.name,statusLabels[n.validation.status],n.validation.level,n.loc?.before??"",n.loc?.after??"",n.loc?.reduction??"","关联文件完整行数；跨节点共享，不可相加。"])];
      content="\ufeff"+rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(",")).join("\r\n");type="text/csv;charset=utf-8";
    }
    const url=URL.createObjectURL(new Blob([content],{type})),a=el("a");a.href=url;a.download="accelerate-original-graph-audit."+kind;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  document.addEventListener("click",event=>{
    const button=event.target.closest("button");if(!button)return;
    if(button.dataset.auditInspect)inspect(button.dataset.auditInspect);
    if(button.dataset.auditTab){state.tab=button.dataset.auditTab;renderPanel();panel.querySelector('[data-audit-tab="'+state.tab+'"]').focus({preventScroll:true});}
    if(button.dataset.auditExport)exportData(button.dataset.auditExport);
  });
  $("audit-status-filter").addEventListener("change",event=>{state.status=event.target.value;decorateTree();});
  $("audit-level-filter").addEventListener("change",event=>{state.level=event.target.value;decorateTree();});
  window.addEventListener("hashchange",readHash);
  globalThis.AccelerateAuditMap={
    ready:errors.length===0,errors,inspect,refresh,exportData,
    getState:()=>({...state,view:view.viewMode(),mapping:{total:records.size,flows:[...records.values()].filter(r=>r.kind==="flow").length,steps:[...records.values()].filter(r=>r.kind==="step").length,domains:[...records.values()].filter(r=>r.kind==="domain").length}}),
    mapping:[...records.values()].map(r=>({nativeId:r.id,auditKey:r.key,kind:r.kind,owner:r.owner||null}))
  };
  const initialHash=location.hash;
  refresh();
  if(initialHash.startsWith("#node=")){try{inspect(decodeURIComponent(initialHash.slice(6)));}catch(_){}}
})();
