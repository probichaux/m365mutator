// Catalog of writable Entra ID user attributes that the Identities page can
// randomly mutate, each paired with a generator producing a plausible but
// obviously-synthetic value.
//
// Manager and Sponsors are intentionally absent: they are navigation
// properties set via a $ref to another directory object, not scalar values
// that can be assigned a random string.

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const STREET_NAMES = ['Maple', 'Oak', 'Cedar', 'Birch', 'Elm', 'Pine', 'Willow', 'Aspen'];
const STREET_SUFFIXES = ['St', 'Ave', 'Blvd', 'Ln', 'Way', 'Dr'];
const CITIES = ['Lviv', 'Kyiv', 'København', 'München', 'Paris', 'Huntsville', 'Dallas', 'Craców'];
const STATES = ['CA', 'NY', 'TX', 'WA', 'IL', 'FL', 'CO', 'MA'];
const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'Poland', 'Ukraine', 'France', 'Italy', 'Spain', 'Netherlands', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Belgium', 'Switzerland', 'Austria', 'Ireland', 'Portugal', 'Greece', 'Czech Republic', 'Hungary', 'Romania', 'Bulgaria', 'Slovakia', 'Slovenia', 'Croatia'];
const JOB_TITLES = ['Analyst', 'Engineer', 'Coordinator', 'Manager', 'Specialist', 'Consultant'];
const COMPANIES = ['Contoso', 'Fabrikam', 'Northwind Traders', 'Adventure Works', 'Tailspin Toys'];
const DEPARTMENTS = ['Sales', 'Engineering', 'Marketing', 'Finance', 'Operations', 'Support'];
const EMPLOYEE_TYPES = ['Employee', 'Contractor', 'Consultant', 'Vendor'];
const OFFICES = ['Parken 6', 'Parken 7', 'Lviv', 'Kyiv', 'Remote', 'Dallas', 'Długa 1', 'Długa 2'];

function randomPhone(): string {
  return `+1 ${randInt(200, 999)} ${randInt(200, 999)} ${String(randInt(0, 9999)).padStart(4, '0')}`;
}

function randomHireDate(): string {
  // Some day in the last ~15 years, at midnight UTC, ISO 8601.
  const year = randInt(2010, 2025);
  const month = String(randInt(1, 12)).padStart(2, '0');
  const day = String(randInt(1, 28)).padStart(2, '0');
  return `${year}-${month}-${day}T00:00:00Z`;
}

export interface MutableAttribute {
  /** Graph property name used in the PATCH body. */
  name: string;
  /** Friendly label shown in the UI. */
  label: string;
  /** Produce a fresh random value for this attribute. */
  generate: () => unknown;
}

export const MUTABLE_ATTRIBUTES: readonly MutableAttribute[] = [
  { name: 'streetAddress', label: 'Street address', generate: () => `${randInt(1, 9999)} ${pick(STREET_NAMES)} ${pick(STREET_SUFFIXES)}` },
  { name: 'city', label: 'City', generate: () => pick(CITIES) },
  { name: 'state', label: 'State or province', generate: () => pick(STATES) },
  { name: 'postalCode', label: 'ZIP or postal code', generate: () => String(randInt(10000, 99999)) },
  { name: 'country', label: 'Country or region', generate: () => pick(COUNTRIES) },
  { name: 'businessPhones', label: 'Business phone', generate: () => [randomPhone()] },
  { name: 'mobilePhone', label: 'Mobile phone', generate: () => randomPhone() },
  { name: 'jobTitle', label: 'Job title', generate: () => pick(JOB_TITLES) },
  { name: 'companyName', label: 'Company name', generate: () => pick(COMPANIES) },
  { name: 'department', label: 'Department', generate: () => pick(DEPARTMENTS) },
  { name: 'employeeId', label: 'Employee ID', generate: () => `E${String(randInt(0, 999999)).padStart(6, '0')}` },
  { name: 'employeeType', label: 'Employee type', generate: () => pick(EMPLOYEE_TYPES) },
  { name: 'employeeHireDate', label: 'Employee hire date', generate: randomHireDate },
  { name: 'officeLocation', label: 'Office location', generate: () => pick(OFFICES) },
];

/** Pick one attribute at random from the mutable catalog. */
export function pickRandomAttribute(): MutableAttribute {
  return pick(MUTABLE_ATTRIBUTES);
}
