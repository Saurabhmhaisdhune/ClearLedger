import 'dotenv/config';
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import { UserModel } from '../models/User.model';
import { TransactionModel } from '../models/Transaction.model';
import { AlertRuleModel } from '../models/AlertRule.model';
import { DEFAULT_ALERT_RULES } from '../config/defaultRules';
import { scoreTransaction } from '../modules/transactions/riskEngine';
import { hashPassword } from '../modules/auth/auth.service';
import { TRANSACTION_STATUS } from '../utils/constants';

// ─── Config ───────────────────────────────────────────────────────────────
const TOTAL_TRANSACTIONS = 5000;
const BATCH_SIZE = 100; // Insert in batches to avoid memory overload

// Primary countries — India-centric with neighbouring and trading partners
const COUNTRIES = [
  'IN', 'IN', 'IN', 'IN', 'IN', // India appears most (realistic for Indian bank)
  'US', 'GB', 'SG', 'AE', 'DE',
  'AU', 'CA', 'JP', 'HK', 'CH',
  'FR', 'NL', 'KE', 'ZA', 'MX',
  'BD', 'LK', 'NP', 'MV',        // South Asian neighbours
];

// FATF Grey/Black + RBI Caution list countries
const SANCTIONED_COUNTRIES = ['PK', 'IR', 'KP', 'AF', 'SY', 'MM', 'RU'];

const ALL_COUNTRIES = [
  ...COUNTRIES,
  ...COUNTRIES,
  ...SANCTIONED_COUNTRIES,  // ~10-12% chance
];

const TXN_TYPES = ['RTGS', 'NEFT', 'IMPS', 'SWIFT', 'CASH'] as const;
const CHANNELS = ['ONLINE', 'BRANCH', 'ATM', 'MOBILE'] as const;

// Indian banks (realistic for an Indian AML platform)
const BANKS = [
  'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank',
  'Kotak Mahindra Bank', 'Punjab National Bank', 'Bank of Baroda',
  'Canara Bank', 'Union Bank of India', 'IndusInd Bank',
  'Yes Bank', 'IDFC First Bank', 'Federal Bank', 'South Indian Bank',
  'RBL Bank', 'DCB Bank', 'Bandhan Bank', 'AU Small Finance Bank',
  // Foreign banks operating in India
  'Citibank India', 'HSBC India', 'Standard Chartered India',
  'Deutsche Bank India', 'DBS Bank India', 'Barclays India',
];

// ─── Generate a Single Fake Transaction ──────────────────────────────────

function generateRawTransaction(index: number) {
  const senderCountry = faker.helpers.arrayElement(ALL_COUNTRIES);
  const receiverCountry = faker.helpers.arrayElement(ALL_COUNTRIES);
  const txnType = faker.helpers.arrayElement(TXN_TYPES);

// India-specific amount distribution in INR
  // ~40% small (under ₹50k), ~35% medium (₹50k-₹10L), ~25% large (above ₹10L)
  let amount: number;
  const amountRange = faker.number.int({ min: 1, max: 100 });

  if (amountRange <= 40) {
    amount = faker.number.float({ min: 500, max: 49999, fractionDigits: 2 });
  } else if (amountRange <= 75) {
    amount = faker.number.float({ min: 50000, max: 999999, fractionDigits: 2 });
  } else {
    amount = faker.number.float({ min: 1000000, max: 50000000, fractionDigits: 2 });
  }

  // ~5% round amounts (structuring signal) — INR round amounts
  if (faker.number.int({ min: 1, max: 20 }) === 1) {
    amount = faker.helpers.arrayElement([
      100000, 200000, 500000, 750000, 800000,
      900000, 950000, 1000000, 2000000, 5000000,
      10000000, 25000000,
    ]);
  }

  // ~3% just below ₹10 Lakh CTR threshold (structuring signal)
  if (faker.number.int({ min: 1, max: 33 }) === 1) {
    amount = faker.number.float({ min: 800000, max: 999999, fractionDigits: 2 });
  }

  const senderId = `ACC-${faker.string.numeric(10)}`;
  const receiverId = `ACC-${faker.string.numeric(10)}`;

  // Spread transactions over the last 12 months for realistic dashboard data
  const processedAt = faker.date.between({
    from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    to: new Date(),
  });

  return {
    txnId: `TXN-${String(index).padStart(6, '0')}-${faker.string.alphanumeric(6).toUpperCase()}`,
    amount: Math.round(amount * 100) / 100,
    currency: 'INR',
    senderId,
    senderName: faker.person.fullName(),
    senderBank: faker.helpers.arrayElement(BANKS),
    senderCountry,
    receiverId,
    receiverName: faker.person.fullName(),
    receiverBank: faker.helpers.arrayElement(BANKS),
    receiverCountry,
    txnType,
    channel: faker.helpers.arrayElement(CHANNELS),
    processedAt,
  };
}

// ─── Seed Users ───────────────────────────────────────────────────────────

async function seedUsers(): Promise<void> {
  console.log('👤 Seeding users...');

  const users = [
    {
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@clearledger.com',
      password: 'Admin@12345',
      role: 'ADMIN',
    },
    {
      firstName: 'Sarah',
      lastName: 'Chen',
      email: 'officer@clearledger.com',
      password: 'Officer@12345',
      role: 'COMPLIANCE_OFFICER',
    },
    {
      firstName: 'James',
      lastName: 'Patel',
      email: 'analyst@clearledger.com',
      password: 'Analyst@12345',
      role: 'ANALYST',
    },
    {
      firstName: 'Emily',
      lastName: 'Watson',
      email: 'auditor@clearledger.com',
      password: 'Auditor@12345',
      role: 'AUDITOR',
    },
  ];

  for (const userData of users) {
    const existing = await UserModel.findOne({ email: userData.email });
    if (!existing) {
      const passwordHash = await hashPassword(userData.password);
      await UserModel.create({
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        passwordHash,
        role: userData.role,
        isActive: true,
      });
      console.log(`  ✅ Created user: ${userData.email} (${userData.role})`);
    } else {
      console.log(`  ⏭️  User already exists: ${userData.email}`);
    }
  }
}

// ─── Seed Alert Rules ─────────────────────────────────────────────────────

async function seedAlertRules(): Promise<void> {
  console.log('📋 Seeding AML alert rules...');

  for (const rule of DEFAULT_ALERT_RULES) {
    const existing = await AlertRuleModel.findOne({ ruleCode: rule.ruleCode });
    if (!existing) {
      await AlertRuleModel.create(rule);
      console.log(`  ✅ Created rule: ${rule.ruleCode}`);
    } else {
      console.log(`  ⏭️  Rule already exists: ${rule.ruleCode}`);
    }
  }
}

// ─── Seed Transactions ────────────────────────────────────────────────────

async function seedTransactions(): Promise<void> {
  console.log(`\n💰 Seeding ${TOTAL_TRANSACTIONS} transactions...`);
  console.log('   (This will take 2-4 minutes — risk engine runs on each transaction)\n');

  const existingCount = await TransactionModel.countDocuments();
  if (existingCount > 0) {
    console.log(`  ⏭️  ${existingCount} transactions already exist. Skipping.`);
    console.log('  💡 To re-seed, run: db.transactions.deleteMany({}) in MongoDB first');
    return;
  }

  let successCount = 0;
  let batch: object[] = [];
  const scoreSummary = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };

  for (let i = 1; i <= TOTAL_TRANSACTIONS; i++) {
    const raw = generateRawTransaction(i);

    // Run through the risk scoring engine
    const scoring = await scoreTransaction({
      txnId: raw.txnId,
      amount: raw.amount,
      txnType: raw.txnType,
      senderCountry: raw.senderCountry,
      receiverCountry: raw.receiverCountry,
      senderId: raw.senderId,
      receiverId: raw.receiverId,
    });

    // Determine initial status based on risk level
    let status: string;
    if (scoring.riskLevel === 'CRITICAL') {
      status = TRANSACTION_STATUS.FLAGGED;
    } else if (scoring.riskLevel === 'HIGH') {
      // 50% flagged, 50% under review (simulate some already being worked)
      status = faker.datatype.boolean()
        ? TRANSACTION_STATUS.FLAGGED
        : TRANSACTION_STATUS.UNDER_REVIEW;
    } else if (scoring.riskLevel === 'MEDIUM') {
      // 20% flagged for review, 80% clear
      status = faker.number.int({ min: 1, max: 5 }) === 1
        ? TRANSACTION_STATUS.FLAGGED
        : TRANSACTION_STATUS.CLEAR;
    } else {
      status = TRANSACTION_STATUS.CLEAR;
    }

    scoreSummary[scoring.riskLevel]++;

    batch.push({
      ...raw,
      riskScore: scoring.riskScore,
      riskLevel: scoring.riskLevel,
      flags: scoring.flags,
      status,
    });

    // Insert in batches of BATCH_SIZE
    if (batch.length === BATCH_SIZE) {
      await TransactionModel.insertMany(batch, { ordered: false });
      successCount += batch.length;
      batch = [];

      // Progress indicator
      const percent = Math.round((successCount / TOTAL_TRANSACTIONS) * 100);
      process.stdout.write(`\r  Progress: ${successCount}/${TOTAL_TRANSACTIONS} (${percent}%)`);
    }
  }

  // Insert any remaining
  if (batch.length > 0) {
    await TransactionModel.insertMany(batch, { ordered: false });
    successCount += batch.length;
  }

  console.log(`\n\n  ✅ Seeded ${successCount} transactions successfully`);
  console.log('\n  📊 Risk Distribution:');
  console.log(`     🟢 LOW:      ${scoreSummary.LOW}`);
  console.log(`     🟡 MEDIUM:   ${scoreSummary.MEDIUM}`);
  console.log(`     🟠 HIGH:     ${scoreSummary.HIGH}`);
  console.log(`     🔴 CRITICAL: ${scoreSummary.CRITICAL}`);
}

// ─── Main Runner ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🌱 ClearLedger Seed Script Starting...\n');

  try {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) throw new Error('MONGODB_URI not defined in .env');

    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB\n');

    await seedUsers();
    await seedAlertRules();
    await seedTransactions();

    console.log('\n\n🎉 Seed complete! ClearLedger database is ready.');
    console.log('\n📝 Test credentials:');
    console.log('   Admin:              admin@clearledger.com    / Admin@12345');
    console.log('   Compliance Officer: officer@clearledger.com  / Officer@12345');
    console.log('   Analyst:            analyst@clearledger.com  / Analyst@12345');
    console.log('   Auditor:            auditor@clearledger.com  / Auditor@12345');

  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

main();