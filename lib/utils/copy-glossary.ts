/**
 * Shared copy glossary for cloud / security acronyms and product nouns.
 *
 * Frontend surfaces frequently derive user-visible names from slugs
 * (e.g. `aws-monitor-guardduty`), which means a naive capitalize-each-word
 * pass produces low-quality output like `Aws Monitor Guardduty` instead of
 * `AWS Monitor GuardDuty`. Every new place that renders a slug must route
 * through these helpers so canonical casing is applied consistently.
 *
 * To add a new term: add a lowercase key mapping to the exact canonical form
 * and extend the test in `__tests__/copy-glossary.test.ts`.
 */

/**
 * Canonical casing for known acronyms / product nouns.
 * Keys MUST be fully lowercase. Values are rendered verbatim.
 */
export const COPY_GLOSSARY: Record<string, string> = {
  // Cloud providers
  aws: "AWS",
  gcp: "GCP",
  // AWS services / primitives
  iam: "IAM",
  ec2: "EC2",
  s3: "S3",
  kms: "KMS",
  vpc: "VPC",
  waf: "WAF",
  sso: "SSO",
  guardduty: "GuardDuty",
  // Compliance frameworks
  pci: "PCI",
  dss: "DSS",
  hipaa: "HIPAA",
  gdpr: "GDPR",
  soc: "SOC",
  nist: "NIST",
  iso: "ISO",
  // Security tooling / concepts
  siem: "SIEM",
  sast: "SAST",
  dast: "DAST",
  mfa: "MFA",
  rbac: "RBAC",
  ddos: "DDoS",
  xss: "XSS",
  csrf: "CSRF",
  cors: "CORS",
  sql: "SQL",
  // Networking / protocols
  dns: "DNS",
  tls: "TLS",
  ssl: "SSL",
  url: "URL",
  api: "API",
  // Delivery / product
  devops: "DevOps",
  cli: "CLI",
  saas: "SaaS",
  ai: "AI",
};

/**
 * Replace known acronyms with their canonical casing anywhere in a string.
 * Matches whole word-like tokens case-insensitively; unknown tokens are left
 * untouched (so it is safe to run on arbitrary UI copy).
 *
 * @example
 * normalizeCopyTerms("Aws Monitor Guardduty") // "AWS Monitor GuardDuty"
 * normalizeCopyTerms("Review iam findings")   // "Review IAM findings"
 */
export function normalizeCopyTerms(input: string): string {
  if (!input) return input;
  return input.replace(/[A-Za-z][A-Za-z0-9]*/g, (token) => {
    const canonical = COPY_GLOSSARY[token.toLowerCase()];
    return canonical ?? token;
  });
}

/**
 * Format a kebab/snake-cased project slug into human-readable display text,
 * applying the shared copy glossary so cloud / security acronyms render
 * correctly.
 *
 * @example
 * formatProjectName("aws-log-analyzer")       // "AWS Log Analyzer"
 * formatProjectName("aws-monitor-guardduty")  // "AWS Monitor GuardDuty"
 * formatProjectName("iam-role-rightsize")     // "IAM Role Rightsize"
 * formatProjectName("pci-dss-evidence-analyzer") // "PCI DSS Evidence Analyzer"
 */
export function formatProjectName(name: string): string {
  if (!name) return name;
  return name
    .split(/[-_]/)
    .map((word) => {
      if (!word) return word;
      const canonical = COPY_GLOSSARY[word.toLowerCase()];
      if (canonical) return canonical;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
