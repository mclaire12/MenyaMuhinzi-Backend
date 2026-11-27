import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import ExcelJS from 'exceljs';
import {
  FarmerCategory,
  FarmerType,
  Language,
  Province,
  RecordStatus,
  UserStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { FarmerRegistrationFieldsDto } from '../farmers/dto/farmer.dto';
import { farmerRoleFor } from '../farmers/farmers.service';
import { EmailVerificationService } from '../users/email-verification.service';
import { UserProvisioningService } from '../users/user-provisioning.service';
import { FacilitatorGroupsService } from './facilitator-groups.service';

/** Most rows one upload may contain. */
export const MAX_IMPORT_ROWS = 500;

export interface RegisteredMember {
  userId: string;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  /** True when the SMTP server accepted the verification email. */
  emailSent: boolean;
}

export interface ImportResult {
  total: number;
  created: (RegisteredMember & { row: number })[];
  failed: { row: number; fullName: string | null; errors: string[] }[];
}

/** Template columns: same information as registering a new farmer. */
const COLUMNS = [
  { key: 'fullName', header: 'Full name', required: true, width: 28 },
  { key: 'phoneNumber', header: 'Phone number', required: true, width: 18 },
  { key: 'email', header: 'Personal email', required: true, width: 30 },
  { key: 'farmerType', header: 'Phone type', required: true, width: 16 },
  { key: 'farmerCategory', header: 'Farmer category', required: false, width: 20 },
  { key: 'preferredLanguage', header: 'Language', required: false, width: 14 },
  { key: 'province', header: 'Province', required: true, width: 16 },
  { key: 'district', header: 'District', required: true, width: 16 },
  { key: 'sector', header: 'Sector', required: true, width: 16 },
  { key: 'cell', header: 'Cell', required: true, width: 16 },
  { key: 'village', header: 'Village', required: true, width: 16 },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];

const FARMER_TYPE_LABELS: Record<string, FarmerType> = {
  smartphone: FarmerType.SMARTPHONE,
  'basic phone': FarmerType.BASIC_PHONE,
  basic: FarmerType.BASIC_PHONE,
  basic_phone: FarmerType.BASIC_PHONE,
};
const CATEGORY_LABELS: Record<string, FarmerCategory> = {
  smallholder: FarmerCategory.SMALLHOLDER,
  'medium scale': FarmerCategory.MEDIUM_SCALE,
  medium_scale: FarmerCategory.MEDIUM_SCALE,
  commercial: FarmerCategory.COMMERCIAL,
  'cooperative member': FarmerCategory.COOPERATIVE_MEMBER,
  cooperative_member: FarmerCategory.COOPERATIVE_MEMBER,
  'lead farmer': FarmerCategory.LEAD_FARMER,
  lead_farmer: FarmerCategory.LEAD_FARMER,
};
const LANGUAGE_LABELS: Record<string, Language> = {
  kinyarwanda: Language.rw,
  rw: Language.rw,
  english: Language.en,
  en: Language.en,
};
const PROVINCE_LABELS: Record<string, Province> = {
  'kigali city': Province.KIGALI_CITY,
  kigali: Province.KIGALI_CITY,
  kigali_city: Province.KIGALI_CITY,
  northern: Province.NORTHERN,
  'northern province': Province.NORTHERN,
  southern: Province.SOUTHERN,
  'southern province': Province.SOUTHERN,
  eastern: Province.EASTERN,
  'eastern province': Province.EASTERN,
  western: Province.WESTERN,
  'western province': Province.WESTERN,
};

const lookup = <T>(labels: Record<string, T>, value: string): T | string =>
  labels[value.trim().toLowerCase()] ?? value.trim();

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text; // hyperlink
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue); // formula
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function flattenErrors(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}).map((message) => `${prefix}${message}`),
    ...flattenErrors(error.children ?? [], `${prefix}${error.property}.`),
  ]);
}

/**
 * Registers new farmers straight into a facilitator group: one at a time or from the Excel
 * template. Each new farmer becomes an active user (visible to administrators under Users)
 * and receives the email-verification link and code.
 */
@Injectable()
export class GroupMemberRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: FacilitatorGroupsService,
    private readonly provisioning: UserProvisioningService,
    private readonly emailVerification: EmailVerificationService,
    private readonly audit: AuditService,
  ) {}

  async register(groupId: string, dto: FarmerRegistrationFieldsDto, actor: AuthenticatedUser): Promise<RegisteredMember> {
    await this.assertOpenGroup(groupId, actor);
    return this.registerInGroup(groupId, dto, actor);
  }

  async importWorkbook(groupId: string, file: Buffer, actor: AuthenticatedUser): Promise<ImportResult> {
    await this.assertOpenGroup(groupId, actor);
    const rows = await this.readRows(file);
    const result: ImportResult = { total: rows.length, created: [], failed: [] };
    for (const { row, values } of rows) {
      const dto = plainToInstance(FarmerRegistrationFieldsDto, {
        fullName: values.fullName,
        phoneNumber: values.phoneNumber.replace(/\s+/g, ''),
        email: values.email,
        farmerType: lookup(FARMER_TYPE_LABELS, values.farmerType),
        ...(values.farmerCategory ? { farmerCategory: lookup(CATEGORY_LABELS, values.farmerCategory) } : {}),
        ...(values.preferredLanguage ? { preferredLanguage: lookup(LANGUAGE_LABELS, values.preferredLanguage) } : {}),
        location: {
          province: lookup(PROVINCE_LABELS, values.province),
          district: values.district,
          sector: values.sector,
          cell: values.cell,
          village: values.village,
        },
      });
      const errors = flattenErrors(await validate(dto, { whitelist: true, forbidNonWhitelisted: true }));
      if (errors.length) {
        result.failed.push({ row, fullName: values.fullName || null, errors });
        continue;
      }
      try {
        result.created.push({ row, ...(await this.registerInGroup(groupId, dto, actor)) });
      } catch (error) {
        if (error instanceof HttpException) {
          result.failed.push({ row, fullName: values.fullName || null, errors: [error.message] });
        } else {
          throw error;
        }
      }
    }
    await this.audit.record({
      actorId: actor.id,
      action: 'group-members.import',
      entityType: 'FacilitatorGroup',
      entityId: groupId,
      details: { total: result.total, created: result.created.length, failed: result.failed.length },
    });
    return result;
  }

  /** The Excel template: one sheet to fill in, one with instructions and allowed values. */
  async template(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MenyaMuhinzi';
    const sheet = workbook.addWorksheet('Farmers', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = COLUMNS.map((column) => ({
      header: column.required ? `${column.header} *` : column.header,
      key: column.key,
      width: column.width,
    }));
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF055225' } };
    const lists: Partial<Record<ColumnKey, string>> = {
      farmerType: '"Smartphone,Basic phone"',
      farmerCategory: '"Smallholder,Medium scale,Commercial,Cooperative member,Lead farmer"',
      preferredLanguage: '"Kinyarwanda,English"',
      province: '"Kigali City,Northern,Southern,Eastern,Western"',
    };
    COLUMNS.forEach((column, index) => {
      const formula = lists[column.key];
      for (let rowNumber = 2; rowNumber <= MAX_IMPORT_ROWS + 1; rowNumber += 1) {
        const cell = sheet.getRow(rowNumber).getCell(index + 1);
        if (formula) {
          cell.dataValidation = { type: 'list', allowBlank: !column.required, formulae: [formula] };
        } else if (column.key === 'phoneNumber') {
          cell.numFmt = '@'; // keep the leading 0 of Rwandan numbers
        }
      }
    });

    const help = workbook.addWorksheet('Instructions');
    help.columns = [{ width: 24 }, { width: 90 }];
    help.addRows([
      ['MenyaMuhinzi — register farmers in a group'],
      [],
      ['How to use', 'Fill one farmer per row on the "Farmers" sheet, then upload the file on the group page.'],
      ['', `Columns marked * are required. At most ${MAX_IMPORT_ROWS} farmers per file.`],
      ['', 'Every farmer becomes a user and receives an email to verify their personal email address.'],
      ['', 'Farmers already registered on the platform are not created again: add them by searching their email.'],
      [],
      ['Phone number', 'Rwandan mobile number, e.g. 0788123456 (each number only once on the platform).'],
      ['Personal email', 'Required, e.g. name@example.rw (each email only once on the platform).'],
      ['Phone type', 'Smartphone, or Basic phone (USSD and voice calls).'],
      ['Farmer category', 'Smallholder, Medium scale, Commercial, Cooperative member or Lead farmer. Empty = Smallholder.'],
      ['Language', 'Kinyarwanda or English. Empty = Kinyarwanda.'],
      ['Province', 'Kigali City, Northern, Southern, Eastern or Western.'],
      ['District, Sector, Cell, Village', 'Required for every farmer.'],
      [],
      ['Example row', 'Mukeshimana Vestine | 0788123456 | vestine@example.rw | Basic phone | Smallholder | Kinyarwanda | Eastern | Nyagatare | Karangazi | Rwimiyaga | Rwisirabo'],
    ]);
    help.getRow(1).font = { bold: true, size: 14 };
    help.getColumn(1).font = { bold: true };
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private async registerInGroup(
    groupId: string,
    dto: FarmerRegistrationFieldsDto,
    actor: AuthenticatedUser,
  ): Promise<RegisteredMember> {
    const { farmerType, farmerCategory, location, ...account } = dto;
    const { userId } = await this.provisioning.provision({
      ...account,
      roles: [farmerRoleFor(farmerType)],
      status: UserStatus.ACTIVE,
      createdById: actor.id,
      location,
      farmer: { farmerType, farmerCategory },
    });
    await this.prisma.facilitatorGroupMember.create({ data: { groupId, userId, addedById: actor.id } });
    const { emailSent } = await this.emailVerification.issue(userId, 'staff-created');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, fullName: true, phoneNumber: true, email: true },
    });
    return { userId: user.id, fullName: user.fullName, phoneNumber: user.phoneNumber, email: user.email, emailSent };
  }

  private async assertOpenGroup(groupId: string, actor: AuthenticatedUser): Promise<void> {
    const group = await this.groups.accessible(groupId, actor);
    if (group.status !== RecordStatus.ACTIVE) throw new ConflictException('Inactive groups cannot take new members');
  }

  /** Reads the first sheet; columns are matched by their header text, empty rows are skipped. */
  private async readRows(file: Buffer): Promise<{ row: number; values: Record<ColumnKey, string> }[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('The file is not a valid Excel (.xlsx) workbook. Use the template.');
    }
    const sheet = workbook.getWorksheet('Farmers') ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('The workbook has no sheet to read');

    const positions = new Map<ColumnKey, number>();
    sheet.getRow(1).eachCell((cell, column) => {
      const text = cellText(cell.value).replace(/\*/g, '').trim().toLowerCase();
      const match = COLUMNS.find((item) => item.header.toLowerCase() === text);
      if (match) positions.set(match.key, column);
    });
    const missing = COLUMNS.filter((column) => column.required && !positions.has(column.key));
    if (missing.length) {
      throw new BadRequestException(
        `Missing columns: ${missing.map((column) => column.header).join(', ')}. Download the template and keep its header row.`,
      );
    }

    const rows: { row: number; values: Record<ColumnKey, string> }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = Object.fromEntries(
        COLUMNS.map((column) => {
          const position = positions.get(column.key);
          return [column.key, position ? cellText(row.getCell(position).value) : ''];
        }),
      ) as Record<ColumnKey, string>;
      if (Object.values(values).every((value) => value === '')) return;
      rows.push({ row: rowNumber, values });
    });
    if (rows.length === 0) throw new BadRequestException('The file has no farmers to import');
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`At most ${MAX_IMPORT_ROWS} farmers can be imported at once`);
    }
    return rows;
  }
}
