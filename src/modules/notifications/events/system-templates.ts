import {
  Language,
  NotificationCategory,
  NotificationChannel,
} from '../../../generated/prisma/client';
import type { VariableDefinition } from '../common/template-renderer';

/**
 * Seed data for the templates used by built-in business events: an in-app and an SMS template per
 * event and language.
 *
 * English templates are seeded ACTIVE. Kinyarwanda texts are written as DRAFT starting points and are
 * not used until a Kinyarwanda speaker reviews them and an administrator activates them; until then
 * notifications fall back to the English template and record the language actually used. Nothing is
 * translated automatically at runtime.
 */
export interface SystemTemplateSeed {
  code: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  language: Language;
  name: string;
  description: string;
  subject: string | null;
  body: string;
  variables: VariableDefinition[];
  /** Seeded as ACTIVE or DRAFT. */
  activate: boolean;
}

const fullName: VariableDefinition = {
  name: 'fullName',
  type: 'string',
  required: true,
  maxLength: 150,
  description: 'Recipient name',
};
const reason: VariableDefinition = {
  name: 'reason',
  type: 'string',
  required: true,
  maxLength: 300,
  description: 'Reason given by the administrator',
};
const courseTitle: VariableDefinition = {
  name: 'courseTitle',
  type: 'string',
  required: true,
  maxLength: 200,
};
const groupName: VariableDefinition = {
  name: 'groupName',
  type: 'string',
  required: true,
  maxLength: 150,
};
const assessmentTitle: VariableDefinition = {
  name: 'assessmentTitle',
  type: 'string',
  required: true,
  maxLength: 200,
};

interface Texts {
  title: string;
  body: string;
  sms: string;
}

interface EventSeed {
  code: string;
  category: NotificationCategory;
  name: string;
  variables: VariableDefinition[];
  en: Texts;
  rw: Texts;
}

const EVENTS: EventSeed[] = [
  {
    code: 'ACCOUNT_APPROVED',
    category: NotificationCategory.ACCOUNT_APPROVAL,
    name: 'Account approved',
    variables: [fullName],
    en: {
      title: 'Your account has been approved',
      body: 'Hello {{fullName}}, your MenyaMuhinzi account has been approved. You can now sign in and start learning.',
      sms: 'MenyaMuhinzi: Hello {{fullName}}, your account has been approved. You can now sign in.',
    },
    rw: {
      title: 'Konti yawe yemejwe',
      body: 'Muraho {{fullName}}, konti yawe kuri MenyaMuhinzi yemejwe. Ubu ushobora kwinjira ugatangira kwiga.',
      sms: 'MenyaMuhinzi: Muraho {{fullName}}, konti yawe yemejwe. Ubu ushobora kwinjira.',
    },
  },
  {
    code: 'ACCOUNT_REJECTED',
    category: NotificationCategory.ACCOUNT_APPROVAL,
    name: 'Account request not approved',
    variables: [fullName, reason],
    en: {
      title: 'Your account request was not approved',
      body: 'Hello {{fullName}}, your account request was not approved. Reason: {{reason}}',
      sms: 'MenyaMuhinzi: Your account request was not approved. Reason: {{reason}}',
    },
    rw: {
      title: 'Ubusabe bwa konti ntibwemejwe',
      body: 'Muraho {{fullName}}, ubusabe bwawe bwo gufungura konti ntibwemejwe. Impamvu: {{reason}}',
      sms: 'MenyaMuhinzi: Ubusabe bwawe bwo gufungura konti ntibwemejwe. Impamvu: {{reason}}',
    },
  },
  {
    code: 'ACCOUNT_SUSPENDED',
    category: NotificationCategory.ACCOUNT,
    name: 'Account suspended',
    variables: [fullName],
    en: {
      title: 'Your account has been suspended',
      body: 'Hello {{fullName}}, your account has been suspended. Contact an administrator if you need more information.',
      sms: 'MenyaMuhinzi: Hello {{fullName}}, your account has been suspended. Contact an administrator for details.',
    },
    rw: {
      title: "Konti yawe yahagaritswe by'agateganyo",
      body: "Muraho {{fullName}}, konti yawe yahagaritswe by'agateganyo. Vugana n'ubuyobozi niba ushaka ibisobanuro.",
      sms: "MenyaMuhinzi: Muraho {{fullName}}, konti yawe yahagaritswe by'agateganyo. Vugana n'ubuyobozi.",
    },
  },
  {
    code: 'ACCOUNT_DEACTIVATED',
    category: NotificationCategory.ACCOUNT,
    name: 'Account deactivated',
    variables: [fullName],
    en: {
      title: 'Your account has been deactivated',
      body: 'Hello {{fullName}}, your account has been deactivated. Contact an administrator if you want to use it again.',
      sms: 'MenyaMuhinzi: Hello {{fullName}}, your account has been deactivated. Contact an administrator for details.',
    },
    rw: {
      title: 'Konti yawe yafunzwe',
      body: "Muraho {{fullName}}, konti yawe yafunzwe. Vugana n'ubuyobozi niba ushaka kongera kuyikoresha.",
      sms: "MenyaMuhinzi: Muraho {{fullName}}, konti yawe yafunzwe. Vugana n'ubuyobozi.",
    },
  },
  {
    code: 'ACCOUNT_REACTIVATED',
    category: NotificationCategory.ACCOUNT,
    name: 'Account active again',
    variables: [fullName],
    en: {
      title: 'Your account is active again',
      body: 'Hello {{fullName}}, your account is active again. You can sign in.',
      sms: 'MenyaMuhinzi: Hello {{fullName}}, your account is active again. You can sign in.',
    },
    rw: {
      title: 'Konti yawe yongeye gukora',
      body: 'Muraho {{fullName}}, konti yawe yongeye gukora. Ushobora kongera kwinjira.',
      sms: 'MenyaMuhinzi: Muraho {{fullName}}, konti yawe yongeye gukora. Ushobora kwinjira.',
    },
  },
  {
    code: 'PASSWORD_CHANGED',
    category: NotificationCategory.SECURITY,
    name: 'Password changed',
    variables: [fullName],
    en: {
      title: 'Your password was changed',
      body: 'Hello {{fullName}}, the password of your account was changed. If this was not you, contact an administrator immediately.',
      sms: 'MenyaMuhinzi: Your password was changed. If this was not you, contact an administrator immediately.',
    },
    rw: {
      title: "Ijambo ry'ibanga ryahinduwe",
      body: "Muraho {{fullName}}, ijambo ry'ibanga rya konti yawe ryahinduwe. Niba atari wowe, vugana n'ubuyobozi ako kanya.",
      sms: "MenyaMuhinzi: Ijambo ry'ibanga ryahinduwe. Niba atari wowe, vugana n'ubuyobozi ako kanya.",
    },
  },
  {
    code: 'COURSE_ENROLLED',
    category: NotificationCategory.COURSE,
    name: 'Enrolled in a course',
    variables: [courseTitle],
    en: {
      title: 'You are enrolled in a course',
      body: 'You are now enrolled in "{{courseTitle}}". Start learning whenever you are ready.',
      sms: 'MenyaMuhinzi: You are now enrolled in "{{courseTitle}}".',
    },
    rw: {
      title: 'Wiyandikishije mu isomo',
      body: 'Wiyandikishije mu isomo "{{courseTitle}}". Tangira kwiga igihe cyose witeguye.',
      sms: 'MenyaMuhinzi: Wiyandikishije mu isomo "{{courseTitle}}".',
    },
  },
  {
    code: 'GROUP_MEMBER_ADDED',
    category: NotificationCategory.GROUP,
    name: 'Added to a farmer group',
    variables: [groupName],
    en: {
      title: 'You were added to a group',
      body: 'You were added to the group "{{groupName}}".',
      sms: 'MenyaMuhinzi: You were added to the group "{{groupName}}".',
    },
    rw: {
      title: 'Wongewe mu itsinda',
      body: 'Wongewe mu itsinda "{{groupName}}".',
      sms: 'MenyaMuhinzi: Wongewe mu itsinda "{{groupName}}".',
    },
  },
  {
    code: 'ASSESSMENT_REVIEWED',
    category: NotificationCategory.ASSESSMENT,
    name: 'Assessment reviewed',
    variables: [assessmentTitle],
    en: {
      title: 'Your assessment has been reviewed',
      body: 'Your answers to "{{assessmentTitle}}" have been reviewed. Check your results.',
      sms: 'MenyaMuhinzi: Your answers to "{{assessmentTitle}}" have been reviewed.',
    },
    rw: {
      title: 'Isuzuma ryawe ryarangije gusuzumwa',
      body: 'Ibisubizo byawe by\'isuzuma "{{assessmentTitle}}" byasuzumwe. Reba amanota yawe.',
      sms: 'MenyaMuhinzi: Ibisubizo byawe by\'isuzuma "{{assessmentTitle}}" byasuzumwe.',
    },
  },
];

export const SYSTEM_TEMPLATES: SystemTemplateSeed[] = EVENTS.flatMap((event) =>
  ([Language.en, Language.rw] as const).flatMap((language) => {
    const texts = language === Language.en ? event.en : event.rw;
    const reviewNote =
      language === Language.rw
        ? ' DRAFT starting text: needs review by a Kinyarwanda speaker before activation.'
        : '';
    const common = {
      code: event.code,
      category: event.category,
      language,
      variables: event.variables,
      activate: language === Language.en,
    };
    return [
      {
        ...common,
        channel: NotificationChannel.IN_APP,
        name: `${event.name} (in-app)`,
        description: `Built-in event template.${reviewNote}`,
        subject: texts.title,
        body: texts.body,
      },
      {
        ...common,
        channel: NotificationChannel.SMS,
        name: `${event.name} (SMS)`,
        description: `Built-in event template.${reviewNote}`,
        subject: null,
        body: texts.sms,
      },
    ];
  }),
);
