// Default AML Rules — Calibrated for India
// Regulatory Basis: PMLA 2002, RBI Master Direction on KYC (2016, amended 2023),
// FIU-IND Guidelines, FATF Recommendations

export const DEFAULT_ALERT_RULES = [
  {
    ruleCode: 'LARGE_CASH_TRANSACTION',
    ruleName: 'Large Cash Transaction (CTR)',
    description:
      'Cash transaction at or above ₹10 Lakh threshold. Mandatory Cash Transaction Report (CTR) filing with FIU-IND under PMLA 2002 Section 12.',
    category: 'AMOUNT',
    threshold: 1000000,   // ₹10,00,000 (₹10 Lakh)
    riskWeight: 25,
    isActive: true,
  },
  {
    ruleCode: 'STRUCTURING',
    ruleName: 'Structuring / Smurfing',
    description:
      'Transaction amount between 80%-99.99% of ₹10 Lakh CTR threshold. Suggests deliberate structuring to evade mandatory CTR reporting under PMLA.',
    category: 'AMOUNT',
    threshold: 1000000,   // ₹10 Lakh — calculates 80%-99.99% range
    riskWeight: 40,
    isActive: true,
  },
  {
    ruleCode: 'SANCTIONED_COUNTRY',
    ruleName: 'High-Risk / Sanctioned Country Transfer',
    description:
      'Transaction involves FATF Black/Grey List country or RBI Caution List jurisdiction. Enhanced Due Diligence mandatory per RBI KYC Master Direction 2016.',
    category: 'GEOGRAPHY',
    threshold: 0,
    riskWeight: 55,
    isActive: true,
  },
  {
    ruleCode: 'ROUND_AMOUNT_STRUCTURING',
    ruleName: 'Round Amount Structuring',
    description:
      'Transaction is a round number (divisible by 1000) above ₹1 Lakh. Statistically rare in genuine transactions — common in structured layering.',
    category: 'PATTERN',
    threshold: 100000,    // ₹1,00,000 (₹1 Lakh)
    riskWeight: 20,
    isActive: true,
  },
  {
    ruleCode: 'HIGH_VALUE_WIRE',
    ruleName: 'High Value RTGS / NEFT / SWIFT Transfer',
    description:
      'Large RTGS, NEFT, or SWIFT transfer above ₹50 Lakh. Requires Enhanced Due Diligence and source of funds documentation per RBI guidelines.',
    category: 'AMOUNT',
    threshold: 5000000,   // ₹50,00,000 (₹50 Lakh)
    riskWeight: 30,
    isActive: true,
  },
  {
    ruleCode: 'VELOCITY_BREACH',
    ruleName: 'Transaction Velocity Breach',
    description:
      'Account initiates more than 5 transactions within 24 hours. Potential smurfing or automated layering — FIU-IND typology reference TY-2023-04.',
    category: 'VELOCITY',
    threshold: 5,         // More than 5 transactions in 24 hours
    riskWeight: 40,
    isActive: true,
  },
  {
    ruleCode: 'RAPID_IN_OUT',
    ruleName: 'Rapid In-Out (Pass-Through / Layering)',
    description:
      'Account receives funds and initiates outgoing transfers within 2 hours. Classic layering behaviour identified in FIU-IND annual typology report.',
    category: 'PATTERN',
    threshold: 2,
    riskWeight: 45,
    isActive: true,
  },
  {
    ruleCode: 'DORMANT_ACCOUNT_ACTIVATION',
    ruleName: 'Dormant Account Sudden Activity',
    description:
      'Account inactive for 90+ days suddenly initiates high-value transactions. RBI Circular DBR.No.Leg.BC.34/09.07.005/2019 flags dormant account misuse.',
    category: 'PATTERN',
    threshold: 90,        // Days of inactivity
    riskWeight: 35,
    isActive: true,
  },
];