// Default AML rules — seeded into the DB on first run
// Admin can modify thresholds and weights via the UI later

export const DEFAULT_ALERT_RULES = [
  {
    ruleCode: 'LARGE_CASH_TRANSACTION',
    ruleName: 'Large Cash Transaction',
    description:
      'Single cash transaction at or above the regulatory reporting threshold. Required by FinCEN/BSA.',
    category: 'AMOUNT',
    threshold: 10000,   // USD 10,000 — US BSA reporting threshold
    riskWeight: 25,
    isActive: true,
  },
  {
    ruleCode: 'STRUCTURING',
    ruleName: 'Structuring / Smurfing',
    description:
      'Transaction amount is between 80% and 99.99% of the reporting threshold — suggests deliberate structuring to avoid reporting.',
    category: 'AMOUNT',
    threshold: 10000,   // Threshold to calculate 80%-99.99% range against
    riskWeight: 40,
    isActive: true,
  },
  {
    ruleCode: 'SANCTIONED_COUNTRY',
    ruleName: 'Sanctioned Country Transfer',
    description:
      'Transaction origin or destination matches OFAC/UN sanctions list country.',
    category: 'GEOGRAPHY',
    threshold: 0,       // No monetary threshold — any amount triggers this
    riskWeight: 55,
    isActive: true,
  },
  {
    ruleCode: 'ROUND_AMOUNT_STRUCTURING',
    ruleName: 'Round Amount Structuring',
    description:
      'Transaction is a round number (divisible by 1000) above the threshold. Statistically rare in legitimate transactions.',
    category: 'PATTERN',
    threshold: 5000,    // Only flag round amounts above USD 5,000
    riskWeight: 20,
    isActive: true,
  },
  {
    ruleCode: 'HIGH_VALUE_WIRE',
    ruleName: 'High Value Wire / SWIFT Transfer',
    description:
      'Large international wire or SWIFT transfer above threshold warrants enhanced due diligence.',
    category: 'AMOUNT',
    threshold: 50000,   // USD 50,000
    riskWeight: 30,
    isActive: true,
  },
  {
    ruleCode: 'VELOCITY_BREACH',
    ruleName: 'Transaction Velocity Breach',
    description:
      'Sender has made more than the threshold number of transactions within 24 hours — possible smurfing or automated fraud.',
    category: 'VELOCITY',
    threshold: 5,       // More than 5 transactions in 24 hours
    riskWeight: 40,
    isActive: true,
  },
  {
    ruleCode: 'RAPID_IN_OUT',
    ruleName: 'Rapid In-Out (Pass-Through)',
    description:
      'Recipient account sends funds out within 2 hours of receiving — classic layering behavior.',
    category: 'PATTERN',
    threshold: 2,       // 2+ outgoing transactions within 2 hours of receiving
    riskWeight: 45,
    isActive: true,
  },
  {
    ruleCode: 'DORMANT_ACCOUNT_ACTIVATION',
    ruleName: 'Dormant Account Sudden Activity',
    description:
      'Account with no activity for 90+ days suddenly initiates transactions.',
    category: 'PATTERN',
    threshold: 90,      // Days of inactivity
    riskWeight: 35,
    isActive: true,
  },
];