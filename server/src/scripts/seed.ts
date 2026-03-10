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

// ─── Realistic Data Pools ─────────────────────────────────────────────────

const COUNTRIES = [
  'US', 'GB', 'IN', 'SG', 'AE', 'DE', 'AU', 'CA', 'FR', 'JP',
  'HK', 'CH', 'NL', 'SE', 'NO', 'BR', 'MX', 'ZA', 'KE', 'NG',
];

// A few sanctioned countries mixed in to ensure CRITICAL/HIGH transactions
const SANCTIONED_COUNTRIES = ['IR', 'KP', 'SY', 'MM', 'RU'];

// All countries pool (mostly normal, some sanctioned)
const ALL_COUNTRIES = [
  ...COUNTRIES,
  ...COUNTRIES, // Doubled so normal countries appear more frequently
  ...SANCTIONED_COUNTRIES, // ~10% chance of sanctioned country
];

const TXN_TYPES = ['WIRE', 'ACH', 'SWIFT', 'INTERNAL', 'CASH'] as const;
const CHANNELS = ['ONLINE', 'BRANCH', 'ATM', 'MOBILE'] as const;

const BANKS = [
  'JPMorgan Chase Bank', 'Bank of America', 'Wells Fargo Bank',
  'Citibank NA', 'HSBC Bank', 'Barclays Bank', 'Deutsche Bank',
  'BNP Paribas', 'Standard Chartered', 'DBS Bank',
  'ICICI Bank', 'HDFC Bank', 'Axis Bank', 'SBI',
  'Commonwealth Bank', 'ANZ Bank', 'Westpac Banking',
];

// ─── Generate a Single Fake Transaction ──────────────────────────────────

function generateRawTransaction(index: number) {
  const senderCountry = faker.helpers.arrayElement(ALL_COUNTRIES);
  const receiverCountry = faker.helpers.arrayElement(ALL_COUNTRIES);
  const txnType = faker.helpers.arrayElement(TXN_TYPES);

  // Create varied amount distribution:
  // ~40% small (under $5k), ~35% medium ($5k-$50k), ~25% large (over $50k)
  let amount: number;
  const amountRange = faker.number.int({ min: 1, max: 100 });

  if (amountRange <= 40) {
    // Small transactions
    amount = faker.number.float({ min: 50, max: 4999, fractionDigits: 2 });
  } else if (amountRange <= 75) {
    // Medium transactions
    amount = faker.number.float({ min: 5000, max: 49999, fractionDigits: 2 });
  } else {
    // Large transactions
    amount = faker.number.float({ min: 50000, max: 500000, fractionDigits: 2 });
  }

  // ~5% of transactions: make amount suspiciously round (structuring signal)
  if (faker.number.int({ min: 1, max: 20 }) === 1) {
    amount = faker.helpers.arrayElement([
      5000, 7000, 8000, 9000, 9500, 10000, 15000,
      20000, 25000, 50000, 75000, 100000,
    ]);
  }

  // ~3% of transactions: amount just below threshold (structuring signal)
  if (faker.number.int({ min: 1, max: 33 }) === 1) {
    amount = faker.number.float({ min: 8000, max: 9999.99, fractionDigits: 2 });
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
    currency: 'USD',
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