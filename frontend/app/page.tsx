"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const MODELS = [
  "GPT-4o-mini",
  "GPT-4.1",
  "Claude-3.5-Sonnet",
  "Claude-3-Opus",
  "Llama-3-70B",
  "Mistral-Large",
  "Gemini-1.5-Pro",
];

interface SystemPrompt {
  id: string;
  content: string;
}

const SYSTEM_PROMPTS: SystemPrompt[] = [
  {
    id: "prompt-1",
    content: `You are an AI code reviewer. Review the following pull request and identify any issues, bugs, or improvements. Be concise and actionable in your feedback.`,
  },
  {
    id: "prompt-2",
    content: `You are an AI assistant that reviews code changes. Analyze the diff provided and point out:
- Potential bugs or errors
- Security concerns
- Performance issues
- Code quality improvements

Provide specific line references where applicable.`,
  },
  {
    id: "prompt-3",
    content: `You are a code review assistant. Your job is to review pull requests and provide constructive feedback. Focus on finding real issues that could cause problems in production. Ignore minor style issues unless they affect readability significantly.

When you find an issue, explain why it's a problem and suggest a fix.`,
  },
  {
    id: "prompt-4",
    content: `Review this pull request as an experienced developer would. Look for:
1. Logic errors
2. Missing error handling
3. Security vulnerabilities
4. Race conditions
5. Resource leaks

Be direct. If the code looks fine, say so. If there are problems, list them clearly.`,
  },
  {
    id: "prompt-5",
    content: `You are an AI that reviews code. Examine the changes in this PR carefully. Your goal is to catch bugs before they reach production. 

Focus on what could go wrong. Consider edge cases. Think about what happens when things fail.

Format your response as a list of findings, ordered by severity.`,
  },
  {
    id: "prompt-6",
    content: `As an AI code reviewer, analyze this pull request. Check for common mistakes like:
- Null/undefined handling
- Error handling gaps
- Input validation
- Authentication/authorization issues
- Data consistency problems

Only flag issues you're confident about. Explain your reasoning briefly.`,
  },
];

const generateGlobalResults = () =>
  MODELS.flatMap((model) =>
    SYSTEM_PROMPTS.map((prompt) => {
      const unsafe =
        (model.includes("Llama") && prompt.id === "prompt-1") ||
        (model === "Gemini-1.5-Pro" && prompt.id === "prompt-4");
      return {
        model,
        promptId: prompt.id,
        promptContent: prompt.content,
        hallucination: unsafe ? 0.18 + Math.random() * 0.08 : 0.02 + Math.random() * 0.05,
        pass: !unsafe,
        note: unsafe ? "High hallucination rate detected" : "Within acceptable thresholds",
      };
    })
  );

interface PR {
  id: string;
  title: string;
  diff: string;
  expectedFocus: string;
  selected: boolean;
}

const initialPRs: PR[] = [
  {
    id: "PR-412",
    title: "Silent return on refund path",
    diff: `diff --git a/src/payments/refunds.ts b/src/payments/refunds.ts
@@ -41,6 +91,10 @@ export async function refundPayment(paymentId: string) {
   const payment = await db.findPayment(paymentId)
+  if (!payment) {
+    return
+  }
   await gateway.refund(payment.chargeId)
 }`,
    expectedFocus: "silent_failure_risk",
    selected: true,
  },
  {
    id: "PR-398",
    title: "Charge without idempotency key",
    diff: `diff --git a/src/payments/charge.ts b/src/payments/charge.ts
@@ -15,7 +15,6 @@ export async function chargeUser(userId: string, amount: number) {
   const user = await db.findUser(userId)
-  const idempotencyKey = generateIdempotencyKey(userId, amount)
   const result = await gateway.charge({
     customerId: user.stripeId,
     amount,
-    idempotencyKey,
   })
 }`,
    expectedFocus: "duplicate_charge_risk",
    selected: true,
  },
  {
    id: "PR-405",
    title: "Missing audit log on payment update",
    diff: `diff --git a/src/payments/update.ts b/src/payments/update.ts
@@ -22,8 +22,6 @@ export async function updatePayment(paymentId: string, data: PaymentUpdate) {
   const payment = await db.findPayment(paymentId)
   await db.updatePayment(paymentId, data)
-  await auditLog.record('payment.updated', { paymentId, changes: data })
   return payment
 }`,
    expectedFocus: "compliance_risk",
    selected: true,
  },
  {
    id: "PR-376",
    title: "Webhook signature TODO",
    diff: `diff --git a/src/webhooks/stripe.ts b/src/webhooks/stripe.ts
@@ -8,7 +8,7 @@ export async function handleStripeWebhook(req: Request) {
   const payload = await req.text()
   const signature = req.headers.get('stripe-signature')
-  const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret)
+  // TODO: verify signature later
+  const event = JSON.parse(payload)
   await processEvent(event)
 }`,
    expectedFocus: "security_vulnerability",
    selected: true,
  },
  {
    id: "PR-421",
    title: "Partial refund rounding logic",
    diff: `diff --git a/src/payments/partial-refund.ts b/src/payments/partial-refund.ts
@@ -12,7 +12,7 @@ export async function partialRefund(paymentId: string, percentage: number) {
   const payment = await db.findPayment(paymentId)
   const originalAmount = payment.amount
-  const refundAmount = Math.round(originalAmount * percentage / 100)
+  const refundAmount = originalAmount * percentage / 100
   await gateway.refund(payment.chargeId, refundAmount)
 }`,
    expectedFocus: "financial_precision",
    selected: true,
  },
  {
    id: "PR-430",
    title: "Retry logic without backoff",
    diff: `diff --git a/src/payments/retry.ts b/src/payments/retry.ts
@@ -5,10 +5,8 @@ export async function retryPayment(paymentId: string) {
   let attempts = 0
   while (attempts < 10) {
     try {
       await processPayment(paymentId)
       return
     } catch (e) {
       attempts++
-      await sleep(Math.pow(2, attempts) * 1000)
     }
   }
 }`,
    expectedFocus: "gateway_abuse",
    selected: true,
  },
  {
    id: "PR-433",
    title: "Nullable currency field",
    diff: `diff --git a/src/payments/types.ts b/src/payments/types.ts
@@ -3,7 +3,7 @@ export interface Payment {
   id: string
   amount: number
-  currency: 'USD' | 'EUR' | 'GBP'
+  currency?: string
   status: PaymentStatus
 }`,
    expectedFocus: "data_integrity",
    selected: true,
  },
  {
    id: "PR-441",
    title: "Async race in settlement",
    diff: `diff --git a/src/settlements/process.ts b/src/settlements/process.ts
@@ -15,9 +15,8 @@ export async function settlePayments(merchantId: string) {
   const payments = await db.findPendingPayments(merchantId)
-  for (const payment of payments) {
-    await settlePayment(payment)
-  }
+  await Promise.all(payments.map(payment => settlePayment(payment)))
   await updateMerchantBalance(merchantId)
 }`,
    expectedFocus: "race_condition",
    selected: true,
  },
  {
    id: "PR-447",
    title: "Missing timeout on provider call",
    diff: `diff --git a/src/providers/stripe.ts b/src/providers/stripe.ts
@@ -8,7 +8,6 @@ export async function callStripe(endpoint: string, data: any) {
   const response = await fetch(\`https://api.stripe.com/\${endpoint}\`, {
     method: 'POST',
     body: JSON.stringify(data),
-    signal: AbortSignal.timeout(30000),
   })
   return response.json()
 }`,
    expectedFocus: "reliability_risk",
    selected: true,
  },
  {
    id: "PR-452",
    title: "Manual retry endpoint exposed",
    diff: `diff --git a/src/api/admin.ts b/src/api/admin.ts
@@ -25,6 +25,12 @@ router.post('/admin/payments/:id/retry', async (req, res) => {
+  router.post('/payments/:id/force-retry', async (req, res) => {
+    const paymentId = req.params.id
+    await retryPayment(paymentId)
+    res.json({ success: true })
+  })
 }`,
    expectedFocus: "abuse_surface",
    selected: true,
  },
  {
    id: "PR-458",
    title: "Hardcoded test credentials",
    diff: `diff --git a/src/config/stripe.ts b/src/config/stripe.ts
@@ -1,5 +1,5 @@ 
-const stripeKey = process.env.STRIPE_SECRET_KEY
+const stripeKey = 'sk_test_51ABC123xyz'
 export const stripe = new Stripe(stripeKey)`,
    expectedFocus: "credential_exposure",
    selected: true,
  },
  {
    id: "PR-461",
    title: "Removed rate limiting middleware",
    diff: `diff --git a/src/middleware/rateLimit.ts b/src/middleware/rateLimit.ts
@@ -8,10 +8,6 @@ export function rateLimitMiddleware(req, res, next) {
-  const clientIp = req.ip
-  if (isRateLimited(clientIp)) {
-    return res.status(429).json({ error: 'Too many requests' })
-  }
   next()
 }`,
    expectedFocus: "dos_vulnerability",
    selected: true,
  },
  {
    id: "PR-465",
    title: "SQL query string interpolation",
    diff: `diff --git a/src/db/queries.ts b/src/db/queries.ts
@@ -12,7 +12,7 @@ export async function findPaymentsByUser(userId: string) {
-  return db.query('SELECT * FROM payments WHERE user_id = $1', [userId])
+  return db.query(\`SELECT * FROM payments WHERE user_id = '\${userId}'\`)
 }`,
    expectedFocus: "sql_injection",
    selected: true,
  },
  {
    id: "PR-469",
    title: "CSRF protection disabled",
    diff: `diff --git a/src/middleware/csrf.ts b/src/middleware/csrf.ts
@@ -5,8 +5,6 @@ export function csrfMiddleware(req, res, next) {
-  if (!validateCsrfToken(req)) {
-    return res.status(403).json({ error: 'Invalid CSRF token' })
-  }
   next()
 }`,
    expectedFocus: "csrf_vulnerability",
    selected: true,
  },
  {
    id: "PR-473",
    title: "Unvalidated redirect parameter",
    diff: `diff --git a/src/api/redirect.ts b/src/api/redirect.ts
@@ -3,8 +3,5 @@ router.get('/redirect', (req, res) => {
   const target = req.query.url
-  if (!isValidRedirectUrl(target)) {
-    return res.status(400).json({ error: 'Invalid redirect URL' })
-  }
   res.redirect(target)
 }`,
    expectedFocus: "open_redirect",
    selected: true,
  },
  {
    id: "PR-477",
    title: "Debug logging in production",
    diff: `diff --git a/src/payments/process.ts b/src/payments/process.ts
@@ -15,6 +15,7 @@ export async function processPayment(paymentId: string) {
   const payment = await db.findPayment(paymentId)
+  console.log('Processing payment:', JSON.stringify(payment))
   const result = await gateway.charge(payment)
   return result
 }`,
    expectedFocus: "data_leakage",
    selected: false,
  },
  {
    id: "PR-481",
    title: "Removed input validation",
    diff: `diff --git a/src/api/payments.ts b/src/api/payments.ts
@@ -8,9 +8,6 @@ router.post('/payments', async (req, res) => {
   const { amount, currency, userId } = req.body
-  if (!isValidAmount(amount) || !isValidCurrency(currency)) {
-    return res.status(400).json({ error: 'Invalid payment data' })
-  }
   const payment = await createPayment({ amount, currency, userId })
   res.json(payment)
 }`,
    expectedFocus: "input_validation",
    selected: false,
  },
  {
    id: "PR-485",
    title: "Exposed internal error stack",
    diff: `diff --git a/src/middleware/errorHandler.ts b/src/middleware/errorHandler.ts
@@ -5,8 +5,5 @@ export function errorHandler(err, req, res, next) {
-  console.error(err)
-  res.status(500).json({ error: 'Internal server error' })
+  res.status(500).json({ error: err.message, stack: err.stack })
 }`,
    expectedFocus: "error_disclosure",
    selected: false,
  },
  {
    id: "PR-489",
    title: "Weak password hashing (MD5)",
    diff: `diff --git a/src/auth/password.ts b/src/auth/password.ts
@@ -3,7 +3,7 @@ import crypto from 'crypto'
 export function hashPassword(password: string) {
-  return bcrypt.hash(password, 12)
+  return crypto.createHash('md5').update(password).digest('hex')
 }`,
    expectedFocus: "weak_cryptography",
    selected: false,
  },
  {
    id: "PR-493",
    title: "Missing admin auth check",
    diff: `diff --git a/src/api/admin.ts b/src/api/admin.ts
@@ -12,7 +12,6 @@ router.delete('/admin/users/:id', async (req, res) => {
-  if (!req.user?.isAdmin) {
-    return res.status(403).json({ error: 'Admin access required' })
-  }
   await db.deleteUser(req.params.id)
   res.json({ success: true })
 }`,
    expectedFocus: "authorization_bypass",
    selected: false,
  },
];

interface RepoResult {
  model: string;
  promptId: string;
  promptContent: string;
  criticalDetection: number;
  verdict: "Recommended" | "Acceptable" | "Rejected";
  explanation: string;
  rank: number;
  scores: {
    precision: number;
    recall: number;
    f1: number;
  };
}

const generateRepoResults = (): RepoResult[] => {
  const results: RepoResult[] = [];
  let rank = 1;

  const combinations = [
    { model: "GPT-4o-mini", promptId: "prompt-3", f1: 0.94, verdict: "Recommended" as const, explanation: "Best detection rate for payment-related issues" },
    { model: "Claude-3.5-Sonnet", promptId: "prompt-4", f1: 0.91, verdict: "Acceptable" as const, explanation: "Strong overall performance, slightly verbose" },
    { model: "GPT-4.1", promptId: "prompt-2", f1: 0.89, verdict: "Acceptable" as const, explanation: "Good coverage with low false positive rate" },
    { model: "Claude-3.5-Sonnet", promptId: "prompt-3", f1: 0.88, verdict: "Acceptable" as const, explanation: "Solid detection, occasionally misses edge cases" },
    { model: "GPT-4o-mini", promptId: "prompt-4", f1: 0.87, verdict: "Acceptable" as const, explanation: "Good balance of precision and recall" },
    { model: "Claude-3-Opus", promptId: "prompt-5", f1: 0.85, verdict: "Acceptable" as const, explanation: "Thorough but sometimes over-cautious" },
    { model: "GPT-4.1", promptId: "prompt-3", f1: 0.84, verdict: "Acceptable" as const, explanation: "Consistent performance across PR types" },
    { model: "Mistral-Large", promptId: "prompt-4", f1: 0.82, verdict: "Acceptable" as const, explanation: "Good for common issues, misses subtle bugs" },
    { model: "Claude-3-Opus", promptId: "prompt-2", f1: 0.80, verdict: "Acceptable" as const, explanation: "Reliable but resource intensive" },
    { model: "GPT-4o-mini", promptId: "prompt-6", f1: 0.79, verdict: "Acceptable" as const, explanation: "Fast with reasonable accuracy" },
    { model: "Gemini-1.5-Pro", promptId: "prompt-4", f1: 0.77, verdict: "Rejected" as const, explanation: "Inconsistent results across runs" },
    { model: "Mistral-Large", promptId: "prompt-2", f1: 0.75, verdict: "Rejected" as const, explanation: "Missed several critical issues" },
    { model: "Llama-3-70B", promptId: "prompt-4", f1: 0.73, verdict: "Rejected" as const, explanation: "High false positive rate" },
    { model: "Gemini-1.5-Pro", promptId: "prompt-3", f1: 0.71, verdict: "Rejected" as const, explanation: "Too permissive on security issues" },
    { model: "Llama-3-70B", promptId: "prompt-3", f1: 0.68, verdict: "Rejected" as const, explanation: "Limited understanding of context" },
  ];

  for (const combo of combinations) {
    const prompt = SYSTEM_PROMPTS.find((p) => p.id === combo.promptId)!;
    const precision = combo.f1 - 0.02 + Math.random() * 0.04;
    const recall = combo.f1 + 0.02 - Math.random() * 0.04;
    results.push({
      model: combo.model,
      promptId: combo.promptId,
      promptContent: prompt.content,
      criticalDetection: combo.f1 + (Math.random() * 0.04 - 0.02),
      verdict: combo.verdict,
      explanation: combo.explanation,
      rank: rank++,
      scores: {
        precision: Math.min(0.99, Math.max(0.4, precision)),
        recall: Math.min(0.99, Math.max(0.4, recall)),
        f1: combo.f1,
      },
    });
  }

  return results;
};

const steps = ["Repository", "Global Filter", "Select PRs", "Results"];

function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="text-[13px] leading-relaxed overflow-x-auto">
      {lines.map((line, i) => {
        let className = "text-zinc-400";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          className = "diff-add";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          className = "diff-remove";
        } else if (line.startsWith("@@") || line.startsWith("diff")) {
          className = "diff-header";
        }
        return (
          <div key={i} className={`${className} px-3 -mx-3`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function ProgressIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center">
          <motion.div
            className="relative flex items-center justify-center"
            initial={false}
            animate={{ scale: i === current ? 1 : 0.9 }}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                i < current
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : i === current
                  ? "bg-zinc-800 text-white border border-zinc-600"
                  : "bg-zinc-900 text-zinc-600 border border-zinc-800"
              }`}
            >
              {i < current ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            {i === current && (
              <motion.div
                className="absolute inset-0 rounded-full border border-green-500/50"
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.3, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            )}
          </motion.div>
          {i < total - 1 && (
            <div
              className={`w-12 h-px mx-2 transition-colors duration-300 ${
                i < current ? "bg-green-500/30" : "bg-zinc-800"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(0);
  const [repo, setRepo] = useState("");
  const [prs, setPrs] = useState(initialPRs);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedPR, setExpandedPR] = useState<string | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);

  const GLOBAL_RESULTS = useMemo(() => generateGlobalResults(), []);
  const REPO_RESULTS = useMemo(() => generateRepoResults(), []);

  const togglePR = (id: string) => {
    setPrs((prev) =>
      prev.map((pr) => (pr.id === id ? { ...pr, selected: !pr.selected } : pr))
    );
  };

  const updateExpectedFocus = (id: string, value: string) => {
    setPrs((prev) =>
      prev.map((pr) => (pr.id === id ? { ...pr, expectedFocus: value } : pr))
    );
  };

  const selectedCount = prs.filter((pr) => pr.selected).length;
  const passedGlobalCount = GLOBAL_RESULTS.filter((r) => r.pass).length;
  const failedGlobalCount = GLOBAL_RESULTS.filter((r) => !r.pass).length;

  const handleNextStep = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setStep((prev) => prev + 1);
    }, 600);
  };

  const pageVariants = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -12 },
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <div className="gradient-blur" />

      <div className="max-w-6xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight">nanite</span>
          </div>
          <ProgressIndicator current={step} total={steps.length} />
        </header>

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="repo"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <div className="max-w-2xl">
                <h1 className="text-3xl font-semibold tracking-tight text-white mb-3">
                  Find the best model + system prompt for PR reviews
                </h1>
                <p className="text-zinc-400 text-lg leading-relaxed">
                  We evaluate different model and system prompt combinations against your real PRs
                  to find the configuration that catches issues that matter in your codebase.
                </p>
              </div>

              <Card className="bg-zinc-900/50 border-zinc-800 backdrop-blur-sm">
                <CardContent className="p-6">
                  <label className="text-sm font-medium text-zinc-300 block mb-3">
                    Repository URL
                  </label>
                  <div className="flex gap-3">
                    <Input
                      placeholder="https://github.com/acme/payments-service"
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                      className="flex-1 bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-600 h-11 focus:border-zinc-700 focus:ring-zinc-700"
                    />
                    <Button
                      disabled={!repo || isLoading}
                      onClick={handleNextStep}
                      className="bg-white text-black hover:bg-zinc-200 h-11 px-6 font-medium"
                    >
                      {isLoading ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                          <span>Analyzing</span>
                        </div>
                      ) : (
                        "Continue"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">Models ({MODELS.length})</h3>
                  <div className="flex flex-wrap gap-2">
                    {MODELS.map((model) => (
                      <span key={model} className="text-sm px-3 py-1.5 rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700/50">
                        {model}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">System Prompts ({SYSTEM_PROMPTS.length})</h3>
                  <div className="space-y-2">
                    {SYSTEM_PROMPTS.map((prompt, idx) => (
                      <div
                        key={prompt.id}
                        className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 transition-all cursor-pointer"
                        onClick={() => setExpandedPrompt(expandedPrompt === prompt.id ? null : prompt.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-zinc-500 mb-1">Prompt {idx + 1}</p>
                            <p className="text-sm text-zinc-300 line-clamp-2 font-mono">
                              {prompt.content.slice(0, 100)}...
                            </p>
                          </div>
                          <svg
                            className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expandedPrompt === prompt.id ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                        <AnimatePresence>
                          {expandedPrompt === prompt.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <pre className="mt-3 p-3 bg-zinc-950 rounded-lg text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed border border-zinc-800">
                                {prompt.content}
                              </pre>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="global"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="flex items-start justify-between gap-8">
                <div className="max-w-xl">
                  <h2 className="text-2xl font-semibold tracking-tight text-white mb-2">
                    Global Safety Filter
                  </h2>
                  <p className="text-zinc-400">
                    Testing {MODELS.length} models x {SYSTEM_PROMPTS.length} system prompts = {MODELS.length * SYSTEM_PROMPTS.length} combinations.
                    High hallucination combinations are filtered out.
                  </p>
                </div>
                <div className="flex gap-3 shrink-0">
                  <div className="px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                    <span className="text-green-400 font-semibold">{passedGlobalCount}</span>
                    <span className="text-zinc-500 ml-2 text-sm">passed</span>
                  </div>
                  <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <span className="text-red-400 font-semibold">{failedGlobalCount}</span>
                    <span className="text-zinc-500 ml-2 text-sm">filtered</span>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3 max-h-[55vh] overflow-auto pr-1">
                {GLOBAL_RESULTS.map((r, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.01 }}
                    className={`p-4 rounded-lg border transition-all ${
                      !r.pass
                        ? "bg-red-950/20 border-red-900/30"
                        : "bg-zinc-900/50 border-zinc-800/50 hover:border-zinc-700/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-zinc-200">{r.model}</p>
                      </div>
                      <div
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          r.pass ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {r.pass ? "PASS" : "FILTERED"}
                      </div>
                    </div>
                    <div className="mb-3">
                      <div
                        className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 flex items-center gap-1"
                        onClick={() => setExpandedPrompt(expandedPrompt === `global-${idx}` ? null : `global-${idx}`)}
                      >
                        <span>System Prompt</span>
                        <svg
                          className={`w-3 h-3 transition-transform ${expandedPrompt === `global-${idx}` ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      <AnimatePresence>
                        {expandedPrompt === `global-${idx}` ? (
                          <motion.pre
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="mt-2 p-2 bg-zinc-950 rounded text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed border border-zinc-800 max-h-40 overflow-auto"
                          >
                            {r.promptContent}
                          </motion.pre>
                        ) : (
                          <p className="text-xs text-zinc-500 mt-1 font-mono line-clamp-1">
                            {r.promptContent.slice(0, 60)}...
                          </p>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Hallucination</span>
                        <span className={`font-mono ${r.hallucination > 0.1 ? "text-red-400" : "text-green-400"}`}>
                          {(r.hallucination * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            r.hallucination > 0.1 ? "bg-red-500" : "bg-green-500"
                          }`}
                          style={{ width: `${Math.min(r.hallucination * 400, 100)}%` }}
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(0)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  Back
                </Button>
                <Button
                  onClick={handleNextStep}
                  disabled={isLoading}
                  className="bg-white text-black hover:bg-zinc-200 font-medium"
                >
                  {isLoading ? "Loading PRs..." : `Continue with ${passedGlobalCount} combinations`}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="dataset"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="flex items-start justify-between gap-8">
                <div className="max-w-xl">
                  <h2 className="text-2xl font-semibold tracking-tight text-white mb-2">
                    Select Evaluation PRs
                  </h2>
                  <p className="text-zinc-400">
                    These PRs define what issues matter in your repository.
                    Expand to view diffs and edit expected focus.
                  </p>
                </div>
                <div className="px-4 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 shrink-0">
                  <span className="text-white font-semibold">{selectedCount}</span>
                  <span className="text-zinc-500 ml-1">/ {prs.length}</span>
                </div>
              </div>

              <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
                {prs.map((pr, idx) => (
                  <motion.div
                    key={pr.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02 }}
                  >
                    <Card
                      className={`bg-zinc-900/50 border-zinc-800 transition-all hover:border-zinc-700 ${
                        pr.selected ? "border-zinc-700" : "opacity-50"
                      }`}
                    >
                      <CardContent className="p-0">
                        <div
                          className="flex items-center gap-4 p-4 cursor-pointer select-none"
                          onClick={() => setExpandedPR(expandedPR === pr.id ? null : pr.id)}
                        >
                          <div onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={pr.selected}
                              onCheckedChange={() => togglePR(pr.id)}
                              className="border-zinc-600 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                                {pr.id}
                              </span>
                              <span className="font-medium text-zinc-200 truncate">
                                {pr.title}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-zinc-500 bg-zinc-800/50 px-2 py-1 rounded font-mono">
                              {pr.expectedFocus}
                            </span>
                            <svg
                              className={`w-4 h-4 text-zinc-500 transition-transform ${
                                expandedPR === pr.id ? "rotate-180" : ""
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedPR === pr.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4 space-y-4 border-t border-zinc-800">
                                <div className="pt-4 bg-zinc-950 rounded-lg p-3 font-mono">
                                  <DiffViewer diff={pr.diff} />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-zinc-500 block mb-2">
                                    Expected Focus
                                  </label>
                                  <Input
                                    value={pr.expectedFocus}
                                    onChange={(e) => updateExpectedFocus(pr.id, e.target.value)}
                                    className="bg-zinc-950 border-zinc-800 text-zinc-200 text-sm h-9 font-mono focus:border-zinc-700"
                                  />
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(1)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  Back
                </Button>
                <Button
                  onClick={handleNextStep}
                  disabled={selectedCount === 0 || isLoading}
                  className="bg-white text-black hover:bg-zinc-200 font-medium"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      <span>Running Evaluation</span>
                    </div>
                  ) : (
                    `Evaluate with ${selectedCount} PRs`
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="results"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <div className="flex items-start justify-between">
                <div className="max-w-xl">
                  <h2 className="text-2xl font-semibold tracking-tight text-white mb-2">
                    Evaluation Results
                  </h2>
                  <p className="text-zinc-400">
                    {REPO_RESULTS.length} model + system prompt combinations ranked by detection accuracy.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setShowAllResults(!showAllResults)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800 border border-zinc-800"
                >
                  {showAllResults ? "Show Top Results" : "Show All Results"}
                </Button>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="relative rounded-2xl border border-green-500/20 bg-gradient-to-b from-green-500/5 to-transparent p-6 overflow-hidden"
              >
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-500/50 to-transparent" />
                <div className="flex items-start justify-between gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-xs font-medium px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30">
                        BEST MATCH
                      </span>
                      <span className="text-xs text-zinc-600">#1 of {REPO_RESULTS.length}</span>
                    </div>
                    <h3 className="text-2xl font-semibold text-white mb-3">
                      {REPO_RESULTS[0].model}
                    </h3>
                    <p className="text-zinc-400 text-sm mb-4">
                      {REPO_RESULTS[0].explanation}
                    </p>
                    <div>
                      <div
                        className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 flex items-center gap-1 mb-2"
                        onClick={() => setExpandedPrompt(expandedPrompt === "best" ? null : "best")}
                      >
                        <span>System Prompt</span>
                        <svg
                          className={`w-3 h-3 transition-transform ${expandedPrompt === "best" ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      <AnimatePresence>
                        {expandedPrompt === "best" ? (
                          <motion.pre
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="p-3 bg-zinc-950 rounded-lg text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed border border-zinc-800 overflow-hidden"
                          >
                            {REPO_RESULTS[0].promptContent}
                          </motion.pre>
                        ) : (
                          <div className="p-3 bg-zinc-950 rounded-lg text-xs text-zinc-400 font-mono border border-zinc-800 line-clamp-2">
                            {REPO_RESULTS[0].promptContent.slice(0, 120)}...
                          </div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                  <div className="flex gap-8 shrink-0">
                    <div className="text-center">
                      <div className="text-4xl font-semibold text-white mb-1">
                        {(REPO_RESULTS[0].criticalDetection * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-zinc-500">Detection</div>
                    </div>
                    <div className="text-center">
                      <div className="text-4xl font-semibold text-green-400 mb-1">
                        {(REPO_RESULTS[0].scores.f1 * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-zinc-500">F1 Score</div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <Button className="bg-white text-black hover:bg-zinc-200 font-medium">
                    Deploy Configuration
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-zinc-400 hover:text-white hover:bg-zinc-800 border border-zinc-800"
                  >
                    Export Results
                  </Button>
                </div>
              </motion.div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium text-zinc-400">
                  {showAllResults ? "All Rankings" : "Top Alternatives"}
                </h3>

                <div className={`space-y-2 ${showAllResults ? "max-h-[45vh] overflow-auto pr-1" : ""}`}>
                  {(showAllResults ? REPO_RESULTS.slice(1) : REPO_RESULTS.slice(1, 6)).map((r, idx) => (
                    <motion.div
                      key={`${r.model}-${r.promptId}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + idx * 0.03 }}
                    >
                      <Card
                        className={`bg-zinc-900/50 border-zinc-800 ${
                          r.verdict === "Rejected" ? "opacity-50" : ""
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <span className="text-lg font-semibold text-zinc-600 w-8 shrink-0">#{r.rank}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-4 mb-2">
                                <div className="flex-1">
                                  <h4 className="font-semibold text-zinc-200">{r.model}</h4>
                                  <p className="text-xs text-zinc-500 mt-1">{r.explanation}</p>
                                </div>
                                <div className="flex items-center gap-4 shrink-0">
                                  <div className="text-center">
                                    <div className="text-sm font-semibold text-zinc-300">
                                      {(r.scores.f1 * 100).toFixed(0)}%
                                    </div>
                                    <div className="text-xs text-zinc-600">F1</div>
                                  </div>
                                  <span
                                    className={`text-xs px-2 py-1 rounded font-medium ${
                                      r.verdict === "Acceptable"
                                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                        : r.verdict === "Recommended"
                                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                                        : "bg-red-500/10 text-red-400 border border-red-500/20"
                                    }`}
                                  >
                                    {r.verdict}
                                  </span>
                                </div>
                              </div>
                              <div>
                                <div
                                  className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 flex items-center gap-1"
                                  onClick={() => setExpandedPrompt(expandedPrompt === r.promptId ? null : r.promptId)}
                                >
                                  <span>System Prompt</span>
                                  <svg
                                    className={`w-3 h-3 transition-transform ${expandedPrompt === r.promptId ? "rotate-180" : ""}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                                <AnimatePresence>
                                  {expandedPrompt === r.promptId ? (
                                    <motion.pre
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="mt-2 p-3 bg-zinc-950 rounded-lg text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed border border-zinc-800 overflow-hidden"
                                    >
                                      {r.promptContent}
                                    </motion.pre>
                                  ) : (
                                    <p className="text-xs text-zinc-500 mt-1 font-mono line-clamp-1">
                                      {r.promptContent.slice(0, 80)}...
                                    </p>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(2)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  Adjust PRs
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setStep(0)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  Start Over
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
