const INTENT_TRIGGERS = Object.freeze([
  ['admin_dashboard', ['儀表板', '仪表板', '管理工作台']],
  ['partner_workspace', ['業務專區', '业务专区', '夥伴專區', '伙伴专区', '分銷商專區', '分销商专区']],
  ['traveler_workspace', ['我的行程', '旅客中心', '會員中心', '会员中心']],
  ['generic_workspace', ['工作台', '我的工作台']]
]);

function normalizeInput(input) {
  if (typeof input !== 'string') return null;
  return input.replace(/\u3000/g, ' ').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function routeWorkspaceIntent(input) {
  const normalized = normalizeInput(input);
  if (normalized === null) return { matched: false, intent: 'unknown', trigger: '' };

  for (const [intent, triggers] of INTENT_TRIGGERS) {
    for (const trigger of triggers) {
      if (normalized === trigger.toLocaleLowerCase()) {
        return { matched: true, intent, trigger };
      }
    }
  }

  return { matched: false, intent: 'unknown', trigger: '' };
}

export { routeWorkspaceIntent };
export default routeWorkspaceIntent;
