const STORAGE_KEY = "department-project-dashboard-v1";
const roles = { owner: "Owner", core: "核心成员", support: "支持者" };

const currentMonth = new Date().toISOString().slice(0, 7);
const seedData = {
  members: [
    { id: "m1", name: "陈晓", title: "培训项目经理" },
    { id: "m2", name: "林然", title: "课程运营" },
    { id: "m3", name: "周航", title: "学习平台运营" }
  ],
  projects: [
    {
      id: "p1", name: "新经理训练营", priority: "P0", temporary: false, crossDepartment: true,
      startDate: `${currentMonth}-03`, endDate: `${currentMonth}-27`, progress: 68,
      assignments: [{ memberId: "m1", role: "owner" }, { memberId: "m2", role: "core" }, { memberId: "m3", role: "support" }],
      milestones: [
        { name: "课程方案评审完成", deadline: `${currentMonth}-08`, completed: true },
        { name: "首期课程交付与数据复盘", deadline: `${currentMonth}-27`, completed: false }
      ],
      notes: "与业务部门联合交付，重点关注参训完成率。"
    },
    {
      id: "p2", name: "学习平台内容焕新", priority: "P1", temporary: false, crossDepartment: false,
      startDate: `${currentMonth}-06`, endDate: `${currentMonth}-30`, progress: 42,
      assignments: [{ memberId: "m3", role: "owner" }, { memberId: "m2", role: "core" }],
      milestones: [{ name: "完成重点栏目内容上架", deadline: `${currentMonth}-22`, completed: false }],
      notes: "优先更新高访问量栏目。"
    },
    {
      id: "p3", name: "销售案例临时共创", priority: "P1", temporary: true, crossDepartment: true,
      startDate: `${currentMonth}-12`, endDate: `${currentMonth}-20`, progress: 100,
      assignments: [{ memberId: "m2", role: "owner" }, { memberId: "m1", role: "support" }],
      milestones: [{ name: "案例包交付并验收", deadline: `${currentMonth}-20`, completed: true }],
      notes: "销售部门发起的临时支持任务。"
    }
  ],
  performance: {}
};

const metricRules = [
  {
    key: "completion", name: "培训项目完成率", weight: 0.3,
    help: "当月及时实际交付数量 ÷ 当月计划交付数量；临时项目指跨部门发起的整体临时任务。",
    tiers: "多于1个临时任务及时交付：1.2；1个：1.1；完成率=1：1.0；1个未完成：0.9；多于1个未完成：0.8"
  },
  {
    key: "quality", name: "培训项目产出质量", weight: 0.3,
    help: "正常交付为按时交付且验收达标；加分项为范例、内部帮带或克服核心难题；减分项为验收未达标或未独立产出。项目负责人可勾选缺项。",
    tiers: "加分项>1：1.2；加分项=1：1.1；正常交付：1.0；减分项=1：0.9；减分项>1：0.8"
  },
  {
    key: "result", name: "培训项目结果数据", weight: 0.3,
    help: "结果数据 = 考核测评通过率 × 50% + 满意度达标率 × 50%。",
    tiers: ">105%：1.2；103%-105%：1.1；98%-102%：1.0；95%-98%：0.9；<95%：0.8"
  },
  {
    key: "activity", name: "学习平台活跃度", weight: 0.1,
    help: "活跃度 = 学员参培率 × 50% + 参训完成率 × 50%。原表未提供分档，页面沿用结果数据的五档区间。",
    tiers: ">105%：1.2；103%-105%：1.1；98%-102%：1.0；95%-98%：0.9；<95%：0.8"
  }
];

let state = loadState();
let selectedMonth = currentMonth;
let cloudClient = null;
let cloudUser = null;
let cloudSaveTimer = null;
let cloudChannel = null;
let applyingCloudState = false;
let lastCloudUpdatedAt = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved?.members && saved?.projects ? saved : structuredClone(seedData);
  } catch {
    return structuredClone(seedData);
  }
}

function milestoneCompletedForProject(milestone, project) {
  if (milestone.memberCompletions) {
    const participantIds = [...new Set(project.assignments.map(item => item.memberId))];
    return participantIds.length > 0 && participantIds.every(memberId => milestone.memberCompletions[memberId] === true);
  }
  return Boolean(milestone.completed);
}

function calculateProjectProgress(project) {
  if (!project.milestones?.length) return 0;
  const completedCount = project.milestones.filter(milestone => milestoneCompletedForProject(milestone, project)).length;
  return Math.round(completedCount / project.milestones.length * 100);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!applyingCloudState) scheduleCloudSave();
}

function cloudConfig() {
  return window.APP_CONFIG || {};
}

function isCloudConfigured() {
  const config = cloudConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase?.createClient);
}

function setCloudStatus(status, text) {
  const button = $("#cloud-status-btn");
  button.classList.remove("online", "syncing", "error");
  if (status) button.classList.add(status);
  button.querySelector("span").textContent = text;
  $("#cloud-sidebar-status").textContent = text;
}

function setCloudMessage(message, isError = false) {
  const target = $("#cloud-message");
  target.textContent = message;
  target.style.color = isError ? "#c7434b" : "";
}

function updateCloudAccountUi() {
  $("#cloud-signed-out").classList.toggle("hidden", Boolean(cloudUser));
  $("#cloud-signed-in").classList.toggle("hidden", !cloudUser);
  $("#cloud-user-email").textContent = cloudUser?.email || "";
  setCloudStatus(cloudUser ? "online" : "", cloudUser ? "云端已连接" : "云端登录");
}

function scheduleCloudSave() {
  if (!cloudClient || !cloudUser) return;
  clearTimeout(cloudSaveTimer);
  setCloudStatus("syncing", "正在保存");
  cloudSaveTimer = setTimeout(saveCloudState, 700);
}

async function saveCloudState() {
  if (!cloudClient || !cloudUser) return;
  const config = cloudConfig();
  const updatedAt = new Date().toISOString();
  const { error } = await cloudClient
    .from("department_app_state")
    .upsert({
      id: config.workspaceId || "department-project-dashboard",
      data: state,
      updated_at: updatedAt,
      updated_by: cloudUser.id
    }, { onConflict: "id" });
  if (error) {
    setCloudStatus("error", "云端保存失败");
    setCloudMessage(`保存失败：${error.message}`, true);
    return;
  }
  lastCloudUpdatedAt = updatedAt;
  setCloudStatus("online", "云端已保存");
}

async function loadCloudState(showMessage = false) {
  if (!cloudClient || !cloudUser) return;
  setCloudStatus("syncing", "正在同步");
  const config = cloudConfig();
  const workspaceId = config.workspaceId || "department-project-dashboard";
  const { data, error } = await cloudClient
    .from("department_app_state")
    .select("data,updated_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    setCloudStatus("error", "同步失败");
    setCloudMessage(`同步失败：${error.message}`, true);
    return;
  }
  if (!data) {
    await saveCloudState();
    if (showMessage) setCloudMessage("已将本机数据创建为部门云端数据。");
    return;
  }
  applyingCloudState = true;
  state = data.data;
  lastCloudUpdatedAt = data.updated_at;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyingCloudState = false;
  renderAll();
  setCloudStatus("online", "云端已同步");
  if (showMessage) setCloudMessage("已读取最新的部门共享数据。");
}

function subscribeCloudState() {
  if (!cloudClient || !cloudUser) return;
  if (cloudChannel) cloudClient.removeChannel(cloudChannel);
  const workspaceId = cloudConfig().workspaceId || "department-project-dashboard";
  cloudChannel = cloudClient
    .channel(`department-state-${workspaceId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "department_app_state",
      filter: `id=eq.${workspaceId}`
    }, payload => {
      const remote = payload.new;
      if (!remote?.data || remote.updated_by === cloudUser.id || remote.updated_at === lastCloudUpdatedAt) return;
      applyingCloudState = true;
      state = remote.data;
      lastCloudUpdatedAt = remote.updated_at;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      applyingCloudState = false;
      renderAll();
      setCloudStatus("online", "已收到同事更新");
    })
    .subscribe();
}

async function handleCloudSession(session) {
  cloudUser = session?.user || null;
  updateCloudAccountUi();
  if (cloudUser) {
    await loadCloudState();
    subscribeCloudState();
  } else if (cloudChannel) {
    cloudClient.removeChannel(cloudChannel);
    cloudChannel = null;
  }
}

async function initializeCloud() {
  if (!isCloudConfigured()) {
    setCloudStatus("", "云端待配置");
    setCloudMessage("请先在 config.js 中填写 Supabase 项目信息。");
    return;
  }
  const config = cloudConfig();
  cloudClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data } = await cloudClient.auth.getSession();
  await handleCloudSession(data.session);
  cloudClient.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleCloudSession(session), 0);
  });
}

async function sendCloudLogin(email) {
  if (!cloudClient) {
    setCloudMessage("云端尚未配置，请先完成 Supabase 设置。", true);
    return;
  }
  setCloudMessage("正在发送登录链接...");
  const { error } = await cloudClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split("#")[0] }
  });
  setCloudMessage(error ? `发送失败：${error.message}` : "登录链接已发送，请检查邮箱。", Boolean(error));
}

async function signOutCloud() {
  if (!cloudClient) return;
  await cloudClient.auth.signOut();
  setCloudMessage("已退出云端账号，本机副本仍然保留。");
}

function monthProjects() {
  return state.projects.filter(project => project.startDate.slice(0, 7) <= selectedMonth && project.endDate.slice(0, 7) >= selectedMonth);
}

function memberName(id) {
  return state.members.find(member => member.id === id)?.name || "未知成员";
}

function projectOwner(project) {
  const assignment = project.assignments.find(item => item.role === "owner");
  return assignment ? memberName(assignment.memberId) : "未指定";
}

function projectMembersByRole(project, role) {
  const names = project.assignments
    .filter(item => item.role === role)
    .map(item => memberName(item.memberId));
  return names.length ? names.join("、") : "未指定";
}

function currentMilestone(project) {
  if (!project.milestones?.length) return "未设置";
  const current = project.milestones.find(item => !milestoneCompletedForProject(item, project));
  return current?.name || "已全部完成";
}

function performanceKey(memberId) {
  return `${selectedMonth}:${memberId}`;
}

function scoreTier(value) {
  if (!Number.isFinite(value)) return null;
  if (value > 1.05) return 1.2;
  if (value >= 1.03) return 1.1;
  if (value >= 0.98) return 1;
  if (value >= 0.95) return 0.9;
  return 0.8;
}

function calculateMetricScore(key, inputs) {
  if (inputs.missing) return null;
  if (key === "completion") {
    const planned = Number(inputs.a);
    const delivered = Number(inputs.b);
    const temporary = Number(inputs.c || 0);
    if (!planned) return null;
    const unfinished = Math.max(0, planned - delivered);
    if (temporary > 1 && delivered >= planned) return 1.2;
    if (temporary === 1 && delivered >= planned) return 1.1;
    if (unfinished > 1) return 0.8;
    if (unfinished === 1) return 0.9;
    return 1;
  }
  if (key === "quality") {
    if (inputs.a === "" && inputs.b === "") return null;
    const bonus = Number(inputs.a || 0);
    const penalty = Number(inputs.b || 0);
    if (bonus > 1) return 1.2;
    if (bonus === 1) return 1.1;
    if (penalty > 1) return 0.8;
    if (penalty === 1) return 0.9;
    return 1;
  }
  const firstRate = Number(inputs.a);
  const secondRate = Number(inputs.b);
  if (!Number.isFinite(firstRate) || !Number.isFinite(secondRate) || inputs.a === "" || inputs.b === "") return null;
  return scoreTier((firstRate + secondRate) / 200);
}

function metricWeight(record, rule) {
  const customWeight = Number(record?.weights?.[rule.key]);
  return Number.isFinite(customWeight) && customWeight >= 0 ? customWeight / 100 : rule.weight;
}

function calculatePerformance(record) {
  let weighted = 0;
  let activeWeight = 0;
  const details = {};
  const projectDetails = {};
  metricRules.forEach(rule => {
    const metricRecord = record?.[rule.key] || {};
    let score;
    if (rule.key === "completion") {
      score = calculateMetricScore(rule.key, metricRecord);
    } else if (metricRecord.projects) {
      const scores = Object.entries(metricRecord.projects)
        .map(([projectId, inputs]) => {
          const projectScore = calculateMetricScore(rule.key, inputs);
          projectDetails[rule.key] ||= {};
          projectDetails[rule.key][projectId] = projectScore;
          return projectScore;
        })
        .filter(value => value !== null);
      score = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
    } else {
      score = calculateMetricScore(rule.key, metricRecord);
    }
    details[rule.key] = score;
    if (score !== null) {
      const weight = metricWeight(record, rule);
      weighted += score * weight;
      activeWeight += weight;
    }
  });
  return { score: activeWeight ? weighted / activeWeight : null, details, projectDetails };
}

function renderAll() {
  state.projects.forEach(project => {
    project.progress = calculateProjectProgress(project);
  });
  renderDashboard();
  renderProjects();
  renderPerformance();
}

function renderDashboard() {
  const projects = monthProjects();
  const average = projects.length ? Math.round(projects.reduce((sum, project) => sum + Number(project.progress), 0) / projects.length) : 0;
  $("#stat-projects").textContent = projects.length;
  $("#stat-temp").textContent = `${projects.filter(project => project.temporary).length} 个临时任务`;
  $("#stat-active").textContent = projects.filter(project => project.progress > 0 && project.progress < 100).length;
  $("#stat-progress").textContent = `${average}%`;

  const grid = $("#member-grid");
  grid.innerHTML = "";
  if (!state.members.length) {
    grid.innerHTML = '<div class="empty-state">还没有成员，请先添加部门成员。</div>';
  }
  state.members.forEach((member, index) => {
    const roleOrder = { owner: 0, core: 1, support: 2 };
    const assignments = projects
      .flatMap(project => project.assignments.filter(item => item.memberId === member.id).map(item => ({ ...item, project })))
      .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.project.startDate.localeCompare(b.project.startDate));
    const card = document.createElement("article");
    card.className = "member-card";
    card.innerHTML = `
      <div class="member-head">
        <div class="avatar" style="background:${["#5b5ce2", "#18a999", "#ef9f31", "#df5d64"][index % 4]}">${escapeHtml(member.name.slice(-1))}</div>
        <div><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.title)}</span></div>
      </div>
      ${assignments.length ? assignments.map(({ project, role }) => `
        <div class="member-project member-project-${role}">
          <div class="project-line">
            <button class="project-link" data-project-id="${project.id}">${escapeHtml(project.name)}</button>
            <span class="role-badge role-${role}">${roles[role]}</span>
          </div>
          <div class="mini-progress"><i style="width:${project.progress}%"></i></div>
        </div>`).join("") : '<div class="empty-state">本月暂无项目</div>'}
    `;
    grid.appendChild(card);
  });
  renderGantt(projects);
}

function renderGantt(projects) {
  const chart = $("#gantt-chart");
  const [year, month] = selectedMonth.split("-").map(Number);
  const days = new Date(year, month, 0).getDate();
  $("#gantt-caption").textContent = `${year}年${month}月项目排期与当前进度`;
  if (!projects.length) {
    chart.innerHTML = '<div class="empty-state">本月暂无项目排期</div>';
    return;
  }
  const header = Array.from({ length: days }, (_, i) => `<div class="gantt-cell gantt-header">${i + 1}</div>`).join("");
  const rows = projects.map(project => {
    const start = project.startDate.slice(0, 7) < selectedMonth ? 1 : Number(project.startDate.slice(-2));
    const end = project.endDate.slice(0, 7) > selectedMonth ? days : Number(project.endDate.slice(-2));
    const left = ((start - 1) / days) * 100;
    const width = ((end - start + 1) / days) * 100;
    return `
      <div class="gantt-name">${escapeHtml(project.name)}</div>
      ${Array.from({ length: days }, () => '<div class="gantt-cell"></div>').join("")}
      <div class="gantt-track">
        <div class="gantt-bar" style="left:${left}%;width:${width}%">
          <i style="width:${project.progress}%"></i><span>${project.progress}%</span>
        </div>
      </div>`;
  }).join("");
  chart.innerHTML = `<div class="gantt-grid" style="--days:${days}">
    <div class="gantt-cell gantt-name">项目 / 日期</div>${header}${rows}
  </div>`;
}

function renderProjects() {
  const priority = $("#priority-filter").value;
  const search = $("#project-search").value.trim().toLowerCase();
  const projects = monthProjects().filter(project => (!priority || project.priority === priority) && (!search || project.name.toLowerCase().includes(search)));
  $("#project-table-body").innerHTML = projects.length ? projects.map(project => `
    <tr data-project-id="${project.id}">
      <td><strong>${escapeHtml(project.name)}</strong></td>
      <td><span class="priority ${project.priority}">${project.priority}</span></td>
      <td>${escapeHtml(projectOwner(project))}</td>
      <td>${escapeHtml(projectMembersByRole(project, "core"))}</td>
      <td>${escapeHtml(projectMembersByRole(project, "support"))}</td>
      <td><span class="milestone-status">${escapeHtml(currentMilestone(project))}</span></td>
      <td>${project.startDate} 至 ${project.endDate}</td>
      <td>${project.temporary ? '<span class="tag">临时</span>' : ""}${project.crossDepartment ? '<span class="tag">跨部门</span>' : ""}</td>
      <td class="progress-cell"><div class="progress-label"><span>项目进度</span><strong>${project.progress}%</strong></div><div class="mini-progress"><i style="width:${project.progress}%"></i></div></td>
    </tr>`).join("") : '<tr><td colspan="9"><div class="empty-state">没有符合条件的项目</div></td></tr>';
}

function renderPerformance() {
  const select = $("#performance-member");
  const previous = select.value;
  select.innerHTML = state.members.map(member => `<option value="${member.id}">${escapeHtml(member.name)} · ${escapeHtml(member.title)}</option>`).join("");
  select.value = state.members.some(member => member.id === previous) ? previous : state.members[0]?.id || "";
  renderPerformanceForm();
  $("#rules-list").innerHTML = metricRules.map(rule => {
    const weightLabel = ["completion", "quality"].includes(rule.key)
      ? `${rule.weight * 100}%±5%`
      : `${rule.weight * 100}%`;
    return `<div class="rule-item"><strong>${rule.name} · 权重${weightLabel}</strong><p>${rule.tiers}</p></div>`;
  }).join("");
}

function renderMemberManagement() {
  $("#member-count").textContent = `${state.members.length} 人`;
  const list = $("#member-management-list");
  list.innerHTML = state.members.length ? state.members.map((member, index) => {
    const projectCount = state.projects.filter(project => project.assignments.some(item => item.memberId === member.id)).length;
    return `
      <div class="management-member-row">
        <div class="avatar small-avatar" style="background:${["#5b5ce2", "#18a999", "#ef9f31", "#df5d64"][index % 4]}">${escapeHtml(member.name.slice(-1))}</div>
        <div class="management-member-info">
          <strong>${escapeHtml(member.name)}</strong>
          <span>${escapeHtml(member.title)} · 参与 ${projectCount} 个项目</span>
        </div>
        <button type="button" class="btn danger small delete-member-btn" data-member-delete="${member.id}">删除</button>
      </div>`;
  }).join("") : '<div class="empty-state">当前没有部门成员</div>';
}

function openMemberManagement() {
  renderMemberManagement();
  $("#member-dialog").showModal();
}

function deleteMember(memberId) {
  const member = state.members.find(item => item.id === memberId);
  if (!member) return;
  const projectCount = state.projects.filter(project => project.assignments.some(item => item.memberId === memberId)).length;
  const message = projectCount
    ? `确认删除 ${member.name} 吗？该成员将从 ${projectCount} 个项目的成员分工中移除。`
    : `确认删除 ${member.name} 吗？`;
  if (!confirm(message)) return;
  state.members = state.members.filter(item => item.id !== memberId);
  state.projects.forEach(project => {
    project.assignments = project.assignments.filter(item => item.memberId !== memberId);
    project.progress = calculateProjectProgress(project);
  });
  Object.keys(state.performance).forEach(key => {
    if (key.endsWith(`:${memberId}`)) delete state.performance[key];
  });
  saveState();
  renderMemberManagement();
  renderAll();
}

function memberPerformanceProjects(memberId) {
  return monthProjects().filter(project => project.assignments.some(item => item.memberId === memberId));
}

function metricInputs(rule, record, projects) {
  const value = record?.[rule.key] || {};
  const missing = value.missing ? "checked" : "";
  if (rule.key === "completion") {
    return `<div class="metric-inputs">
      <label>计划交付数<input type="number" min="0" data-metric="${rule.key}" data-input="a" value="${value.a ?? ""}"></label>
      <label>及时实际交付数<input type="number" min="0" data-metric="${rule.key}" data-input="b" value="${value.b ?? ""}"></label>
      <label>及时交付的临时任务数<input type="number" min="0" data-metric="${rule.key}" data-input="c" value="${value.c ?? ""}"></label>
      <label class="check-label"><input type="checkbox" data-metric="${rule.key}" data-input="missing" ${missing}> 本月无此指标</label>
    </div>`;
  }
  if (!projects.length) return '<div class="empty-state compact-empty">该成员本月暂无参与项目</div>';
  return `<div class="project-metric-list">
    ${projects.map((project, index) => {
      const projectValue = value.projects?.[project.id] || (index === 0 && !value.projects ? value : {});
      const projectMissing = projectValue.missing ? "checked" : "";
      const labels = rule.key === "quality"
        ? ["加分项数量", "减分项数量"]
        : rule.key === "result"
          ? ["考核测评通过率（%）", "满意度达标率（%）"]
          : ["学员参培率（%）", "参训完成率（%）"];
      return `<div class="project-metric-row">
        <div class="project-metric-name">
          <strong>${escapeHtml(project.name)}</strong>
          <span>${roles[project.assignments.find(item => item.memberId === $("#performance-member").value)?.role] || ""}</span>
        </div>
        <label>${labels[0]}<input type="number" min="0" step="${rule.key === "quality" ? "1" : "0.1"}" data-project-metric="${rule.key}" data-project-id="${project.id}" data-project-input="a" value="${projectValue.a ?? ""}"></label>
        <label>${labels[1]}<input type="number" min="0" step="${rule.key === "quality" ? "1" : "0.1"}" data-project-metric="${rule.key}" data-project-id="${project.id}" data-project-input="b" value="${projectValue.b ?? ""}"></label>
        <label class="check-label project-missing"><input type="checkbox" data-project-metric="${rule.key}" data-project-id="${project.id}" data-project-input="missing" ${projectMissing}> 此项目缺项</label>
        <span class="project-metric-score" data-project-score="${rule.key}:${project.id}">-</span>
      </div>`;
    }).join("")}
    <div class="metric-average"><span>项目平均档位</span><strong data-metric-average="${rule.key}">-</strong></div>
  </div>`;
}

function renderPerformanceForm() {
  const memberId = $("#performance-member").value;
  const record = state.performance[performanceKey(memberId)] || {};
  const projects = memberPerformanceProjects(memberId);
  $("#performance-form").innerHTML = metricRules.map(rule => `
    <div class="metric-card">
      <div class="metric-title">
        <strong>${rule.name}</strong>
        <label class="weight-editor">权重
          <input type="number" min="0" max="100" step="1" data-weight="${rule.key}" value="${record.weights?.[rule.key] ?? rule.weight * 100}">
          <span>%</span>
        </label>
      </div>
      ${metricInputs(rule, record, projects)}
      <p class="metric-help">${rule.help}</p>
    </div>`).join("");
  $("#performance-form").insertAdjacentHTML("afterbegin", '<div class="weight-summary">当前权重合计：<strong id="weight-total">100%</strong><span>缺项时按有效维度权重自动归一化</span></div>');
  updatePerformancePreview();
}

function collectPerformanceForm() {
  const record = { weights: {} };
  $$("[data-weight]").forEach(input => {
    record.weights[input.dataset.weight] = input.value;
  });
  $$("[data-metric]").forEach(input => {
    record[input.dataset.metric] ||= {};
    record[input.dataset.metric][input.dataset.input] = input.type === "checkbox" ? input.checked : input.value;
  });
  $$("[data-project-metric]").forEach(input => {
    const metric = input.dataset.projectMetric;
    const projectId = input.dataset.projectId;
    record[metric] ||= { projects: {} };
    record[metric].projects ||= {};
    record[metric].projects[projectId] ||= {};
    record[metric].projects[projectId][input.dataset.projectInput] = input.type === "checkbox" ? input.checked : input.value;
  });
  return record;
}

function updatePerformancePreview() {
  const record = collectPerformanceForm();
  const calculation = calculatePerformance(record);
  const totalWeight = metricRules.reduce((sum, rule) => sum + Number(record.weights[rule.key] || 0), 0);
  const weightTotal = $("#weight-total");
  if (weightTotal) {
    weightTotal.textContent = `${totalWeight}%`;
    weightTotal.classList.toggle("weight-warning", Math.abs(totalWeight - 100) > 0.01);
  }
  $("#performance-score").textContent = calculation.score === null ? "-" : calculation.score.toFixed(2);
  $("#performance-level").textContent = calculation.score === null ? "等待填写" : calculation.score >= 1.1 ? "表现突出" : calculation.score >= 1 ? "达成目标" : "需要关注";
  $("#score-breakdown").innerHTML = metricRules.map(rule => `<div><span>${rule.name} · ${Number(record.weights[rule.key] || 0)}%</span><strong>${calculation.details[rule.key] === null ? "缺项" : calculation.details[rule.key].toFixed(2)}</strong></div>`).join("");
  Object.entries(calculation.projectDetails).forEach(([metric, projects]) => {
    Object.entries(projects).forEach(([projectId, score]) => {
      const target = document.querySelector(`[data-project-score="${metric}:${projectId}"]`);
      if (target) target.textContent = score === null ? "缺项" : score.toFixed(1);
    });
    const average = document.querySelector(`[data-metric-average="${metric}"]`);
    if (average) average.textContent = calculation.details[metric] === null ? "-" : calculation.details[metric].toFixed(2);
  });
}

function openProjectDialog(projectId = null) {
  const form = $("#project-form");
  form.reset();
  const project = state.projects.find(item => item.id === projectId);
  $("#project-dialog-title").textContent = project ? "项目详情" : "新建项目";
  $("#delete-project-btn").classList.toggle("hidden", !project);
  form.elements.id.value = project?.id || "";
  form.elements.name.value = project?.name || "";
  form.elements.priority.value = project?.priority || "P1";
  form.elements.progress.value = project?.progress ?? 0;
  form.elements.startDate.value = project?.startDate || `${selectedMonth}-01`;
  form.elements.endDate.value = project?.endDate || `${selectedMonth}-${String(new Date(...selectedMonth.split("-").map(Number), 0).getDate()).padStart(2, "0")}`;
  form.elements.temporary.checked = Boolean(project?.temporary);
  form.elements.crossDepartment.checked = Boolean(project?.crossDepartment);
  form.elements.notes.value = project?.notes || "";
  $$(".assignment-role-tab").forEach(button => button.classList.toggle("active", button.dataset.roleTab === "owner"));
  $("#assignment-fields").innerHTML = ["owner", "core", "support"].map(role => `
    <div class="assignment-role-panel ${role === "owner" ? "active" : ""}" data-role-panel="${role}">
      ${state.members.map(member => {
        const selected = project?.assignments.some(item => item.memberId === member.id && item.role === role);
        return `<label class="assignment-member-option">
          <input type="${role === "owner" ? "radio" : "checkbox"}" name="assignment-${role}" data-assignment-member="${member.id}" data-assignment-role="${role}" ${selected ? "checked" : ""}>
          ${escapeHtml(member.name)}
        </label>`;
      }).join("") || '<span class="no-milestone-members">请先在成员管理中添加成员</span>'}
    </div>`).join("");
  $("#milestone-fields").innerHTML = "";
  (project?.milestones?.length ? project.milestones : [{ name: "", deadline: "", completed: false }]).forEach(data => addMilestone(data, project?.assignments || []));
  updateProjectProgress();
  $("#project-dialog").showModal();
}

function selectedAssignments() {
  return $$("[data-assignment-member]:checked").map(input => ({
    memberId: input.dataset.assignmentMember,
    role: input.dataset.assignmentRole
  }));
}

function collectMilestoneDrafts() {
  return $$(".milestone-row").map(row => ({
    name: row.querySelector('[data-field="name"]').value,
    deadline: row.querySelector('[data-field="deadline"]').value,
    memberCompletions: Object.fromEntries($$("[data-milestone-member]", row).map(input => [input.dataset.milestoneMember, input.checked]))
  }));
}

function addMilestone(data = {}, fallbackAssignments = selectedAssignments()) {
  const row = $("#milestone-template").content.firstElementChild.cloneNode(true);
  row.querySelector('[data-field="name"]').value = data.name || "";
  row.querySelector('[data-field="deadline"]').value = data.deadline || "";
  const completionMap = data.memberCompletions || {};
  row.dataset.legacyCompleted = data.completed ? "true" : "false";
  renderMilestoneMembers(row, fallbackAssignments, completionMap);
  $("#milestone-fields").appendChild(row);
  updateProjectProgress();
}

function renderMilestoneMembers(row, assignments, completionMap = null) {
  const existing = completionMap || Object.fromEntries($$("[data-milestone-member]", row).map(input => [input.dataset.milestoneMember, input.checked]));
  const participants = [...new Map(assignments.map(item => [item.memberId, item])).values()];
  row.querySelector(".milestone-member-progress").innerHTML = participants.length
    ? participants.map(item => {
        const checked = existing[item.memberId] ?? (row.dataset.legacyCompleted === "true");
        return `<label class="milestone-member-check">
          <input type="checkbox" data-milestone-member="${item.memberId}" ${checked ? "checked" : ""}>
          ${escapeHtml(memberName(item.memberId))} · ${roles[item.role]}
        </label>`;
      }).join("")
    : '<span class="no-milestone-members">请先选择项目参与成员</span>';
  updateMilestoneStatus(row);
}

function syncMilestoneMembers() {
  const drafts = collectMilestoneDrafts();
  $$(".milestone-row").forEach((row, index) => renderMilestoneMembers(row, selectedAssignments(), drafts[index].memberCompletions));
  updateProjectProgress();
}

function updateMilestoneStatus(row) {
  const checks = $$("[data-milestone-member]", row);
  const completed = checks.length > 0 && checks.every(input => input.checked);
  const badge = row.querySelector(".milestone-complete-badge");
  badge.textContent = completed ? "已完成" : "未完成";
  badge.classList.toggle("completed", completed);
  return completed;
}

function updateProjectProgress() {
  const rows = $$(".milestone-row");
  const completedCount = rows.filter(updateMilestoneStatus).length;
  $("#project-form").elements.progress.value = rows.length ? Math.round(completedCount / rows.length * 100) : 0;
}

function saveProject(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.id.value || `p${Date.now()}`;
  const assignments = selectedAssignments();
  const milestones = $$(".milestone-row").map(row => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    deadline: row.querySelector('[data-field="deadline"]').value,
    memberCompletions: Object.fromEntries($$("[data-milestone-member]", row).map(input => [input.dataset.milestoneMember, input.checked])),
    completed: updateMilestoneStatus(row)
  })).filter(item => item.name || item.deadline);
  const progress = milestones.length ? Math.round(milestones.filter(item => item.completed).length / milestones.length * 100) : 0;
  const project = {
    id, name: form.elements.name.value.trim(), priority: form.elements.priority.value,
    progress, startDate: form.elements.startDate.value,
    endDate: form.elements.endDate.value, temporary: form.elements.temporary.checked,
    crossDepartment: form.elements.crossDepartment.checked, notes: form.elements.notes.value.trim(),
    assignments, milestones
  };
  const index = state.projects.findIndex(item => item.id === id);
  if (index >= 0) state.projects[index] = project;
  else state.projects.push(project);
  saveState();
  $("#project-dialog").close();
  renderAll();
}

function deleteProject() {
  const id = $("#project-form").elements.id.value;
  if (!id || !confirm("确认删除这个项目吗？")) return;
  state.projects = state.projects.filter(project => project.id !== id);
  saveState();
  $("#project-dialog").close();
  renderAll();
}

function savePerformance() {
  const memberId = $("#performance-member").value;
  if (!memberId) return;
  state.performance[performanceKey(memberId)] = collectPerformanceForm();
  saveState();
  renderAll();
  alert("本月绩效已保存。");
}

function clearPerformance() {
  const memberId = $("#performance-member").value;
  if (!memberId || !confirm(`确认清空 ${memberName(memberId)} 在 ${selectedMonth} 的绩效数据吗？`)) return;
  delete state.performance[performanceKey(memberId)];
  saveState();
  renderPerformanceForm();
}

function exportPerformanceExcel() {
  const memberId = $("#performance-member").value;
  if (!memberId) return;
  const member = state.members.find(item => item.id === memberId);
  const record = state.performance[performanceKey(memberId)] || collectPerformanceForm();
  const result = calculatePerformance(record);
  const projects = memberPerformanceProjects(memberId);
  const rows = [
    ["月份", selectedMonth],
    ["成员", member?.name || ""],
    ["岗位", member?.title || ""],
    [],
    ["指标", "权重", "档位得分", "计算口径"],
    ...metricRules.map(rule => [rule.name, metricWeight(record, rule), result.details[rule.key] ?? "缺项", rule.help]),
    [],
    ["项目型指标明细"],
    ["指标", "项目名称", "输入值1", "输入值2", "项目档位"],
    ...metricRules.filter(rule => rule.key !== "completion").flatMap(rule =>
      projects.map(project => {
        const inputs = record[rule.key]?.projects?.[project.id] || {};
        return [
          rule.name,
          project.name,
          inputs.a ?? "",
          inputs.b ?? "",
          result.projectDetails[rule.key]?.[project.id] ?? "缺项"
        ];
      })
    ),
    [],
    ["归一化绩效得分", result.score ?? "未填写"]
  ];
  downloadExcelXml([{
    name: "个人绩效",
    rows,
    percentColumns: [1]
  }], `${member?.name || "成员"}_绩效_${selectedMonth}.xls`);
}

function exportSharedData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    selectedMonth,
    data: state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `项目管理共享数据_${selectedMonth}.json`);
}

async function importSharedData(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const imported = payload.data || payload;
    if (!Array.isArray(imported.members) || !Array.isArray(imported.projects) || typeof imported.performance !== "object") {
      throw new Error("文件格式不正确");
    }
    if (!confirm("导入将覆盖本机当前保存的数据，确认继续吗？")) return;
    state = imported;
    state.projects.forEach(project => {
      project.progress = calculateProjectProgress(project);
    });
    selectedMonth = payload.selectedMonth || selectedMonth;
    $("#month-filter").value = selectedMonth;
    saveState();
    renderAll();
    alert("共享数据已导入。");
  } catch {
    alert("无法导入：请选择本网页导出的共享数据文件。");
  }
}

function exportExcel() {
  const projects = monthProjects();
  const projectRows = projects.map(project => [
    project.name, project.priority, project.temporary ? "是" : "否", project.crossDepartment ? "是" : "否",
    project.startDate, project.endDate, project.progress / 100, projectOwner(project),
    projectMembersByRole(project, "core"), projectMembersByRole(project, "support"), currentMilestone(project),
    project.assignments.map(item => `${memberName(item.memberId)}（${roles[item.role]}）`).join("；"),
    project.milestones.map(item => {
      const memberStatus = item.memberCompletions
        ? Object.entries(item.memberCompletions).map(([memberId, done]) => `${memberName(memberId)}:${done ? "完成" : "未完成"}`).join("，")
        : "";
      return `${item.name}｜${item.deadline}｜${item.completed ? "已完成" : "未完成"}${memberStatus ? `｜${memberStatus}` : ""}`;
    }).join("\n"),
    project.notes
  ]);
  const performanceRows = state.members.map(member => {
    const result = calculatePerformance(state.performance[performanceKey(member.id)]);
    return [member.name, member.title, ...metricRules.map(rule => result.details[rule.key] ?? "缺项"), result.score ?? "未填写"];
  });
  const sheets = [
    {
      name: "项目明细",
      rows: [["项目名称", "优先级", "临时任务", "跨部门", "开始日期", "截止日期", "整体进度", "Owner", "核心成员", "支持者", "当前里程碑", "成员及角色", "里程碑及产出", "备注"], ...projectRows],
      percentColumns: [6]
    },
    {
      name: "成员绩效",
      rows: [["成员", "岗位", ...metricRules.map(rule => `${rule.name}档位`), "归一化绩效得分"], ...performanceRows],
      percentColumns: []
    },
    {
      name: "绩效规则",
      rows: [["指标", "权重", "指标计算口径", "实际分档"], ...metricRules.map(rule => [rule.name, rule.weight, rule.help, rule.tiers])],
      percentColumns: [1]
    }
  ];
  downloadExcelXml(sheets, `部门项目与绩效_${selectedMonth}.xls`);
}

function downloadExcelXml(sheets, filename) {
  const xml = buildExcelXml(sheets);
  const blob = new Blob(["\ufeff", xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildExcelXml(sheets) {
  const cell = (value, percent = false) => {
    const isNumber = typeof value === "number";
    const type = isNumber ? "Number" : "String";
    return `<Cell${percent ? ' ss:StyleID="Percent"' : ""}><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
  };
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default"><Alignment ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10"/></Style>
  <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#5B5CE2" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="Percent"><NumberFormat ss:Format="0%"/></Style>
 </Styles>
 ${sheets.map(sheet => `<Worksheet ss:Name="${escapeXml(sheet.name)}"><Table>
  ${sheet.rows.map((row, rowIndex) => `<Row>${row.map((value, columnIndex) => rowIndex === 0 ? `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>` : cell(value, sheet.percentColumns.includes(columnIndex))).join("")}</Row>`).join("")}
 </Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`).join("")}
</Workbook>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}

function bindEvents() {
  $("#month-filter").value = selectedMonth;
  $$(".nav-item").forEach(button => button.addEventListener("click", () => {
    $$(".nav-item").forEach(item => item.classList.remove("active"));
    $$(".view").forEach(view => view.classList.remove("active"));
    button.classList.add("active");
    $(`#${button.dataset.view}-view`).classList.add("active");
    $("#page-title").textContent = { dashboard: "项目总览", projects: "项目管理", performance: "绩效计算" }[button.dataset.view];
  }));
  $("#month-filter").addEventListener("change", event => { selectedMonth = event.target.value; renderAll(); });
  $("#add-project-btn").addEventListener("click", () => openProjectDialog());
  $("#manage-member-btn").addEventListener("click", openMemberManagement);
  $("#cloud-status-btn").addEventListener("click", () => {
    updateCloudAccountUi();
    if (!isCloudConfigured()) setCloudMessage("云端尚未配置，请先在 config.js 中填写 Supabase 项目信息。");
    $("#cloud-dialog").showModal();
  });
  $(".close-cloud-modal").addEventListener("click", () => $("#cloud-dialog").close());
  $("#cloud-login-form").addEventListener("submit", event => {
    event.preventDefault();
    sendCloudLogin(event.currentTarget.elements.email.value.trim());
  });
  $("#cloud-refresh-btn").addEventListener("click", () => loadCloudState(true));
  $("#cloud-signout-btn").addEventListener("click", signOutCloud);
  $("#export-btn").addEventListener("click", exportExcel);
  $("#export-data-btn").addEventListener("click", exportSharedData);
  $("#import-data-btn").addEventListener("click", () => $("#import-data-input").click());
  $("#import-data-input").addEventListener("change", importSharedData);
  $("#priority-filter").addEventListener("change", renderProjects);
  $("#project-search").addEventListener("input", renderProjects);
  $("#performance-member").addEventListener("change", renderPerformanceForm);
  $("#performance-form").addEventListener("input", updatePerformancePreview);
  $("#save-performance-btn").addEventListener("click", savePerformance);
  $("#recalculate-performance-btn").addEventListener("click", updatePerformancePreview);
  $("#clear-performance-btn").addEventListener("click", clearPerformance);
  $("#export-performance-btn").addEventListener("click", exportPerformanceExcel);
  $("#project-form").addEventListener("submit", saveProject);
  $("#add-milestone-btn").addEventListener("click", () => addMilestone());
  $(".assignment-role-tabs").addEventListener("click", event => {
    const button = event.target.closest("[data-role-tab]");
    if (!button) return;
    $$(".assignment-role-tab").forEach(item => item.classList.toggle("active", item === button));
    $$(".assignment-role-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.rolePanel === button.dataset.roleTab));
  });
  $("#assignment-fields").addEventListener("change", event => {
    const input = event.target.closest("[data-assignment-member]");
    if (!input) return;
    if (input.checked) {
      $$(`[data-assignment-member="${input.dataset.assignmentMember}"]`).forEach(other => {
        if (other !== input) other.checked = false;
      });
    }
    syncMilestoneMembers();
  });
  $("#milestone-fields").addEventListener("change", event => {
    if (event.target.matches("[data-milestone-member]")) updateProjectProgress();
  });
  $("#milestone-fields").addEventListener("click", event => {
    if (event.target.classList.contains("remove-milestone")) {
      event.target.closest(".milestone-row").remove();
      updateProjectProgress();
    }
  });
  $("#delete-project-btn").addEventListener("click", deleteProject);
  $$(".close-modal").forEach(button => button.addEventListener("click", () => $("#project-dialog").close()));
  $$(".close-member-modal").forEach(button => button.addEventListener("click", () => $("#member-dialog").close()));
  $("#member-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    state.members.push({ id: `m${Date.now()}`, name: form.elements.name.value.trim(), title: form.elements.title.value.trim() });
    saveState();
    form.reset();
    renderMemberManagement();
    renderAll();
  });
  $("#member-management-list").addEventListener("click", event => {
    const button = event.target.closest("[data-member-delete]");
    if (button) deleteMember(button.dataset.memberDelete);
  });
  document.body.addEventListener("click", event => {
    const target = event.target.closest(".project-link, #project-table-body tr[data-project-id]");
    if (target) openProjectDialog(target.dataset.projectId);
  });
}

bindEvents();
renderAll();
initializeCloud();
