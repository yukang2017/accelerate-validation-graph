
(() => {
  "use strict";
  const metadata = JSON.parse(document.getElementById("accelerate-map-data").textContent);
  const payload = JSON.parse(document.getElementById("lma-data").textContent);
  const plan = payload.plan;
  const byId = new Map(globalThis.LMAFunctionTree.buildNodes(plan.capabilities).map(node => [node.id,node]));
  const capById = new Map(plan.capabilities.map(node => [node.id,node]));
  const flowById = new Map(metadata.flows.map(flow => [flow.capability_id,flow]));
  const inventory = new Set(Object.keys(plan.inventory));
  const count = value => Number(value).toLocaleString("en-US");
  const $ = id => document.getElementById(id);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
  const safePath = path => typeof path === "string" && inventory.has(path) &&
    !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");
  const sourceUrl = reference => {
    if (!safePath(reference.path)) return null;
    let url = "https://github.com/huggingface/accelerate/blob/" + metadata.commit + "/" +
      reference.path.split("/").map(encodeURIComponent).join("/");
    if (Number.isInteger(reference.line) && reference.line > 0) {
      url += "#L" + reference.line;
      if (Number.isInteger(reference.end_line) && reference.end_line >= reference.line)
        url += "-L" + reference.end_line;
    }
    return url;
  };
  const anchor = (text, url) => {
    const link = element("a", text); link.href = url;
    link.target = "_blank"; link.rel = "noopener noreferrer";
    return link;
  };
  setText(document.querySelector(".brand-section"), "功能模块图");
  setText(document.querySelector(".local-badge"), "SOURCE MAP · MAIN");
  setText(document.querySelector(".eyebrow"), "UNDERSTAND THE SYSTEM");
  setText($("project-name"), "Accelerate 功能模块图");
  setText($("project-goal"), "从训练入口到分布式后端，按功能理解 Accelerate。切换关系图与功能树，搜索模块，点击节点查看职责、依赖与对应源码。");
  setText(document.querySelector(".detail-panel .section-kicker"), "模块详情");
  setText(document.querySelector(".trust-note p"), "基于固定版本源码整理。图中的连线用于解释模块关系；同一文件可支撑多个功能。浏览和搜索均在当前页面完成。");
  setText($("tree-navigation-help"), "拖动背景浏览 · + / − 缩放 · 0 适应视图");
  setText($("clear-function-focus"), "显示全部模块");
  setText($("expand-all"), "全部展开");
  setText($("collapse-all"), "收起");
  setText($("fit-tree"), "适应视图");
  $("tree-search").placeholder = "搜索功能、模块或关键词…";
  $("tree-search").setAttribute("aria-label", "搜索功能模块");
  setText(document.querySelector('[data-view-mode="graph"]'), "关系图");
  setText(document.querySelector('[data-view-mode="tree"]'), "功能树");
  setText(document.querySelector('label[for="relationship-filter"]'), "关系范围");
  const relationLabels = {selected:"当前模块",required:"功能依赖",all:"全部关系"};
  for (const option of $("relationship-filter").options) setText(option,relationLabels[option.value] || option.textContent);
  const depthLabels = {detailed:"模块与功能步骤",modules:"仅模块"};
  for (const option of $("function-depth").options) setText(option,depthLabels[option.value] || option.textContent);
  setText($("function-focus").options[0],"整个项目");
  for (const [id,text] of [["function-focus","聚焦模块"],["function-depth","展开层级"]]) {
    const label = $(id).parentElement;
    const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = text;
  }
  // Keep native control elements present: the main viewer owns their lifecycle.
  for (const id of ["budget-slider","budget-number","export-button","submit-button"])
    if ($(id)) $(id).disabled = true;

  const provenance = element("div",undefined,"map-provenance");
  provenance.append(element("span","静态源码分析","map-static-badge"));
  provenance.append(anchor("Accelerate · " + metadata.commit.slice(0,8),
    "https://github.com/huggingface/accelerate/tree/" + metadata.commit));
  provenance.append(anchor("LMA main · " + metadata.harness_commit.slice(0,8),
    "https://github.com/Al-LeanMuscle-Club/LMA/commit/" + metadata.harness_commit));
  provenance.append(element("span","完整模块视图 · 源码未修改"));
  document.querySelector(".page-heading").after(provenance);
  const statistics = element("section",undefined,"map-stats");
  statistics.setAttribute("aria-label","功能地图统计");
  for (const [label,value,caption] of [
    ["功能领域",metadata.stats.domains,"从整体架构进入具体职责"],
    ["功能模块",metadata.stats.flows,"围绕实际能力组织"],
    ["功能步骤",metadata.stats.steps,"展开模块查看细节"],
    ["源码文件",metadata.stats.source_files,count(metadata.stats.source_lines) + " 行 · 含包代码、示例与基准"]
  ]) {
    const card = element("div",undefined,"map-stat");
    card.append(element("div",label,"map-stat-label"),element("div",count(value),"map-stat-number"),
      element("p",caption,"map-stat-caption")); statistics.append(card);
  }
  provenance.after(statistics);
  const sourcePanel = element("section",undefined,"panel map-source-panel");
  sourcePanel.id = "map-source-panel";
  sourcePanel.setAttribute("aria-label","当前模块的源码证据");
  document.querySelector(".detail-panel").after(sourcePanel);

  function descendantFlows(id) {
    return metadata.flows.filter(flow => {
      let cursor = capById.get(flow.capability_id);
      const seen = new Set();
      while (cursor && !seen.has(cursor.id)) {
        if (cursor.id === id) return true;
        seen.add(cursor.id); cursor = capById.get(cursor.parent);
      }
      return false;
    });
  }
  function appendReferences(title, refs, compactLimit) {
    const unique = [...new Map(refs.filter(ref => sourceUrl(ref)).map(ref =>
      [[ref.path,ref.line || 0,ref.name || ""].join(":"),ref])).values()];
    if (!unique.length) return;
    sourcePanel.append(element("h3",title + " · " + unique.length));
    const makeList = values => {
      const list = element("ul",undefined,"map-source-list");
      for (const ref of values) {
        const item = element("li");
        item.append(anchor(ref.name || ref.path,sourceUrl(ref)));
        if (ref.name) item.append(element("small",ref.path + (ref.line ? ":" + ref.line : "")));
        list.append(item);
      }
      return list;
    };
    sourcePanel.append(makeList(unique.slice(0,compactLimit)));
    if (unique.length > compactLimit) {
      const detail = element("details");
      detail.append(element("summary","展开其余 " + (unique.length - compactLimit) + " 项"),
        makeList(unique.slice(compactLimit)));
      sourcePanel.append(detail);
    }
  }
  function renderSourcePanel() {
    const node = byId.get(globalThis.LMACapabilityView.activeId());
    if (!node) return;
    const owner = capById.get(node.owner || node.id);
    const flow = flowById.get(owner.id);
    const groupFlows = flow ? [flow] : descendantFlows(owner.id);
    const step = flow && node.detail ? flow.steps.find(item => item.display_id === node.id) : null;
    sourcePanel.replaceChildren(element("h2","查看对应源码"),
      element("p",node.label + " · 固定版本 " + metadata.commit.slice(0,8)));
    if (!flow && groupFlows.length) {
      const navigation = owner.parent === null
        ? plan.capabilities.filter(item => item.parent === owner.id).map(item => ({name:item.label,capability_id:item.id}))
        : groupFlows;
      sourcePanel.append(element("h3",owner.parent === null ? "按功能领域浏览" : "领域中的功能模块"));
      for (const item of navigation) {
        const button = element("button",item.name,"map-source-flow"); button.type = "button";
        button.addEventListener("click",() => globalThis.LMACapabilityView.inspect(item.capability_id));
        sourcePanel.append(button);
      }
    }
    const symbols = owner.parent === null ? [] : step && step.references.length ? step.references : groupFlows.flatMap(item => item.symbols);
    appendReferences(step ? "步骤实现" : "关键实现",symbols,flow ? 8 : 4);
    const files = [...new Set(groupFlows.flatMap(item => item.files))].map(path => ({path}));
    appendReferences("源码文件",files,flow ? 8 : 3);
    if (!files.length && !symbols.length) sourcePanel.append(element("p","此节点用于组织功能领域；请选择下级模块查看具体实现。","map-source-empty"));
    sourcePanel.append(element("div","链接定位到生成地图时的代码版本。行数描述源码规模，不代表独立可删减的代码量。","map-evidence-note"));
  }

  const detailTitles = {
    "REQUIRES":"依赖模块", "SOURCE FOOTPRINT":"源码规模", "RELATED CAPABILITIES":"相关模块"
  };
  function adaptDetails() {
    const node = byId.get(globalThis.LMACapabilityView.activeId());
    const owner = node && capById.get(node.owner || node.id);
    const isGroup = owner && !flowById.has(owner.id);
    if (owner?.parent === null) setText($("detail-description"),
      "Accelerate 将训练准备、设备与进程管理、分布式后端、大模型推理和工具链组织到统一工作流中。选择下方领域或图中模块，继续查看具体功能和源码实现。");
    for (const block of $("detail-content").querySelectorAll(".detail-block")) {
      const heading = block.querySelector("h3");
      const title = heading?.textContent || "";
      if (["SELECTION","VERIFICATION","VERIFICATION OBLIGATIONS"].includes(title)) block.hidden = true;
      if (detailTitles[title]) setText(heading,detailTitles[title]);
      if (title.startsWith("FUNCTION DETAILS")) setText(heading,"功能步骤");
      if (title === "SOURCE FOOTPRINT") {
        if (isGroup) block.hidden = true;
        for (const paragraph of block.querySelectorAll("p")) paragraph.hidden = true;
        const labels = {"Mapped LOC":"映射行数","Unique LOC":"独占文件行数","Shared LOC":"共享文件行数"};
        for (const term of block.querySelectorAll("dt")) if (labels[term.textContent]) setText(term,labels[term.textContent]);
      }
      if (title === "RELATED CAPABILITIES") {
        for (const paragraph of block.querySelectorAll("li p"))
          setText(paragraph,"源码分析得到的功能关联。");
      }
    }
  }
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      observer.disconnect();
      adaptDetails(); renderSourcePanel();
      observer.observe($("detail-content"),{childList:true,subtree:true});
    });
  });
  adaptDetails(); renderSourcePanel();
  observer.observe($("detail-content"),{childList:true,subtree:true});
  function hideEmptyGroupMetrics() {
    for (const metric of $("capability-tree").querySelectorAll(".node-lines")) {
      const id = metric.closest("[data-capability-id]")?.dataset.capabilityId;
      const node = byId.get(id);
      if (node && !node.detail && !flowById.has(id) && !node.own_lines) metric.hidden = true;
    }
  }
  hideEmptyGroupMetrics();
  new MutationObserver(hideEmptyGroupMetrics).observe($("capability-tree"),{childList:true});
  const graphTitle = () => {
    const graph = globalThis.LMACapabilityView.viewMode() === "graph";
    setText($("tree-heading"),graph ? "功能模块关系图" : "功能模块树");
    setText($("map-description"),graph ? "查看功能分组与模块间的依赖关系。" : "逐层展开领域、模块与具体功能步骤。");
  };
  for (const button of document.querySelectorAll("[data-view-mode]"))
    button.addEventListener("click",graphTitle);
  graphTitle();
  setText(document.querySelector("footer>span:first-child"),"LMA · 让代码结构更清晰");
  setText($("snapshot-label"),"Accelerate " + metadata.commit.slice(0,10) + " · LMA main " + metadata.harness_commit.slice(0,8));
  globalThis.AccelerateModuleMap = {
    source_commit:metadata.commit, harness_commit:metadata.harness_commit,
    stats:metadata.stats, browsing_only:true
  };
})();
