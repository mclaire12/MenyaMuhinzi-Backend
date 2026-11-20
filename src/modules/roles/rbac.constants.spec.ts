import {
  ALL_PERMISSIONS,
  ALL_ROLE_CODES,
  IMMUTABLE_ROLE_CODES,
  PERMISSION_DESCRIPTIONS,
  Permission,
  ROLE_DEFINITIONS,
  RoleCode,
} from './rbac.constants';

describe('RBAC catalogue', () => {
  it('defines exactly the four platform roles', () => {
    expect(ROLE_DEFINITIONS.map((role) => role.code).sort()).toEqual([...ALL_ROLE_CODES].sort());
    expect(ALL_ROLE_CODES).toHaveLength(4);
  });

  it('describes every permission', () => {
    expect(Object.keys(PERMISSION_DESCRIPTIONS).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('grants administrators every permission', () => {
    const admin = ROLE_DEFINITIONS.find((role) => role.code === RoleCode.Admin);
    expect(admin?.permissions.sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(IMMUTABLE_ROLE_CODES).toContain(RoleCode.Admin);
  });

  it('never lets non-admin roles manage users, roles or approvals', () => {
    const privileged: Permission[] = [
      Permission.UsersAssignRoles,
      Permission.UsersManageStatus,
      Permission.RolesManage,
      Permission.AccountRequestsDecide,
      Permission.TargetingGroupsManage,
      Permission.CropsManage,
      Permission.CoursesManage,
      Permission.CoursesPublish,
      Permission.EnrollmentsManage,
      Permission.AssessmentsManage,
      Permission.KnowledgeManage,
      Permission.KnowledgeApprove,
      Permission.AiAssistantsManage,
      Permission.AiModelsRead,
      Permission.AiModelsManage,
      Permission.AiPromptsRead,
      Permission.AiPromptsManage,
      Permission.AiConversationsRead,
      Permission.AiRequestsRead,
      Permission.AiUsageRead,
      Permission.AiSafetyRead,
      Permission.AiSafetyManage,
      Permission.NotificationTemplatesRead,
      Permission.NotificationTemplatesManage,
      Permission.NotificationSettingsRead,
      Permission.NotificationSettingsManage,
      Permission.NotificationDeliveriesRead,
    ];
    for (const role of ROLE_DEFINITIONS.filter((r) => r.code !== RoleCode.Admin)) {
      expect(role.permissions.filter((p) => privileged.includes(p))).toEqual([]);
    }
  });

  it('only grants known permissions', () => {
    for (const role of ROLE_DEFINITIONS) {
      for (const permission of role.permissions) expect(ALL_PERMISSIONS).toContain(permission);
    }
  });
});
