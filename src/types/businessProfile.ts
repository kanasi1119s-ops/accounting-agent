/**
 * 確定申告に必要な事業者プロフィール。「ソロAI帳簿」の src/types.ts の BusinessProfile を移植。
 */
export interface BusinessProfile {
  fiscalYear: number;
  name: string;
  nameKana: string;
  tradeName: string; // 屋号
  postalCode: string;
  address: string; // 納税地
  addressJan1?: string;
  phone: string;
  occupation: string;
  businessDescription: string;
  taxOffice: string;
  filingType: 'blue' | 'white';
  blueDeduction: 650000 | 550000 | 100000 | 0;
  useEtax: boolean;
  invoiceRegNumber: string;
  startDate: string;
  hasFamilyEmployee: boolean;
  familyEmployeeSalary: number;
  consumptionTax: ConsumptionTaxProfile;
  deductions: DeductionInput;
  openingBalances: OpeningBalances;
  closingInventory: number;
  otherIncome: OtherIncomeInput;
}

export interface ConsumptionTaxProfile {
  isTaxable: boolean;
  method: 'principle' | 'simplified' | 'special20';
  simplifiedBusinessType: 1 | 2 | 3 | 4 | 5 | 6;
  accounting: 'tax_included' | 'tax_excluded';
  interimPayment: number;
}

export interface DeductionInput {
  socialInsurance: number;
  smallBusinessMutualAid: number;
  lifeInsurance: number;
  earthquakeInsurance: number;
  medical: number;
  donation: number;
  spouse: number;
  dependent: number;
  basic: number;
  otherPersonal: number;
  taxCredit: number;
}

export interface OpeningBalances {
  現金: number;
  普通預金: number;
  売掛金: number;
  棚卸資産: number;
  固定資産: number;
  その他資産: number;
  買掛金: number;
  未払金: number;
  借入金: number;
  その他負債: number;
  元入金?: number;
}

export interface OtherIncomeInput {
  salaryRevenue: number;
  salaryIncome: number;
  miscIncome: number;
  withholdingTax: number;
  estimatedPrepaid: number;
}

export function defaultBusinessProfile(fiscalYear: number): BusinessProfile {
  return {
    fiscalYear,
    name: '',
    nameKana: '',
    tradeName: '',
    postalCode: '',
    address: '',
    addressJan1: '',
    phone: '',
    occupation: '',
    businessDescription: '',
    taxOffice: '',
    filingType: 'blue',
    blueDeduction: 650000,
    useEtax: true,
    invoiceRegNumber: '',
    startDate: '',
    hasFamilyEmployee: false,
    familyEmployeeSalary: 0,
    consumptionTax: {
      isTaxable: false,
      method: 'principle',
      simplifiedBusinessType: 5,
      accounting: 'tax_included',
      interimPayment: 0,
    },
    deductions: {
      socialInsurance: 0,
      smallBusinessMutualAid: 0,
      lifeInsurance: 0,
      earthquakeInsurance: 0,
      medical: 0,
      donation: 0,
      spouse: 0,
      dependent: 0,
      basic: 480000, // 令和7年分以降の基礎控除（原則）。年度により変わるため必ず最新情報を確認すること。
      otherPersonal: 0,
      taxCredit: 0,
    },
    openingBalances: {
      現金: 0,
      普通預金: 0,
      売掛金: 0,
      棚卸資産: 0,
      固定資産: 0,
      その他資産: 0,
      買掛金: 0,
      未払金: 0,
      借入金: 0,
      その他負債: 0,
    },
    closingInventory: 0,
    otherIncome: {
      salaryRevenue: 0,
      salaryIncome: 0,
      miscIncome: 0,
      withholdingTax: 0,
      estimatedPrepaid: 0,
    },
  };
}
