# KIRIMBA — Firebase & Google Account Setup Guide
**For:** No-code founder setting up the technical foundation  
**Time required:** 45–60 minutes  
**What you'll have at the end:** A live Firebase project ready for your developer to connect to

---

## What You're Setting Up

You need three things:
1. **A Google Account** (if you don't already have one specifically for KIRIMBA)
2. **A Firebase Project** (this is the database, backend, and hosting — all in one)
3. **Google IDX access** (the browser-based coding environment for your developer)

You do not need to install anything on your computer for this guide.

---

## STEP 1 — Create a Dedicated Google Account for KIRIMBA

> **Why?** Keep your personal Google account separate from the business. This account will own everything KIRIMBA-related.

1. Open a browser and go to **accounts.google.com/signup**
2. Fill in:
   - First name: `Kirimba`
   - Last name: `Admin`
   - Email: create something like `admin@kirimba.app` — but since you may not have that domain yet, use `kirimba.platform@gmail.com` or similar
   - Password: use a strong password and save it in a password manager
3. Add a recovery phone number and backup email
4. Finish account creation
5. **Save these credentials somewhere safe** — this is the master key to your platform

> If you already have a Google Workspace with your domain (kirimba.app), use that instead.

---

## STEP 2 — Create the Firebase Project

1. Go to **console.firebase.google.com**
2. Sign in with the Google account you just created
3. Click **"Create a project"** (or "Add project")
4. **Project name:** `kirimba-platform`
   - Firebase will suggest a Project ID like `kirimba-platform-a1b2c` — note this down
5. **Google Analytics:** Click the toggle to **disable** it for now (simplifies setup)
6. Click **"Create project"**
7. Wait 30 seconds while Firebase sets it up
8. Click **"Continue"** when done — you're now in the Firebase console

---

## STEP 3 — Enable Firebase Authentication

1. In the left sidebar, click **"Build"** → **"Authentication"**
2. Click **"Get started"**
3. You'll see "Sign-in providers" — click **"Email/Password"**
4. Toggle **"Enable"** to ON
5. Leave "Email link (passwordless sign-in)" OFF
6. Click **"Save"**

> KIRIMBA uses phone + PIN, but we implement it as email/password in Firebase for simplicity. Your developer will handle this — you just need Email/Password enabled.

---

## STEP 4 — Set Up Firestore Database

1. In the left sidebar, click **"Build"** → **"Firestore Database"**
2. Click **"Create database"**
3. **Security rules:** Select **"Start in production mode"** (more secure — your developer will add proper rules)
4. **Location:** Select the region closest to Burundi:
   - Choose **`europe-west1`** (Belgium) — this is the closest available region to East Africa with good latency
5. Click **"Enable"**
6. Wait for Firestore to provision (about 30 seconds)

---

## STEP 5 — Enable Firebase Functions

1. In the left sidebar, click **"Build"** → **"Functions"**
2. Click **"Get started"**
3. Firebase will ask you to upgrade your plan — this is required for Cloud Functions

### Upgrading to the Blaze (Pay-as-you-go) Plan

> **Don't worry** — at pilot scale (30-100 users), your Firebase bill will be effectively $0. The free tier covers millions of reads/writes per month. You only pay if you exceed generous free limits. But you need the Blaze plan to use Cloud Functions at all.

4. Click **"Upgrade project"**
5. Select **"Blaze"** plan
6. You'll need to add a payment method (credit or debit card)
7. **Set a budget alert:**
   - After adding payment, click **"Set a budget alert"**
   - Enter: **$10** monthly budget
   - This means you'll get an email if you ever approach $10/month (very unlikely at pilot scale)
8. Click **"Continue"** and complete the upgrade
9. Back in Functions: click **"Get started"** → **"Next"** → **"Finish"**

---

## STEP 6 — Set Up Firebase Hosting

1. In the left sidebar, click **"Build"** → **"Hosting"**
2. Click **"Get started"**
3. Firebase will walk you through a setup guide — **skip the terminal steps** (your developer will do those)
4. Click **"Next"** → **"Next"** → **"Continue to console"**
5. You'll see your default hosting URL: `kirimba-platform-a1b2c.web.app` — note this down

---

## STEP 7 — Get Your Firebase Config (for the Developer)

Your developer needs a configuration object to connect the app to Firebase.

1. In the Firebase console, click the **gear icon** (⚙️) next to "Project Overview" in the top-left
2. Click **"Project settings"**
3. Scroll down to **"Your apps"**
4. Click the **web icon** (`</>`)
5. **App nickname:** `kirimba-web`
6. Check **"Also set up Firebase Hosting"**
7. Click **"Register app"**
8. You'll see a code block that looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "kirimba-platform-a1b2c.firebaseapp.com",
  projectId: "kirimba-platform-a1b2c",
  storageBucket: "kirimba-platform-a1b2c.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

9. **Copy this entire block** and save it in a document — you'll share it with your developer
10. Click **"Continue to console"**

---

## STEP 8 — Set Up Firebase Storage

1. In the left sidebar, click **"Build"** → **"Storage"**
2. Click **"Get started"**
3. Click **"Next"** on the security rules screen
4. Select the same region: **`europe-west1`**
5. Click **"Done"**

---

## STEP 9 — Add Your First Admin User (After Development Begins)

> Do this AFTER your developer has built and deployed the app. Skip for now.

Once the app is running:
1. Go to Firebase Console → **Authentication** → **Users**
2. Click **"Add user"**
3. Email: your admin email
4. Password: strong password
5. After creating, your developer will need to set this user's role as `super_admin` using the Firebase console or a seed script

---

## STEP 10 — Set Up Google IDX for Your Developer

Google IDX is a browser-based coding environment — your developer can code without installing anything.

1. Go to **idx.google.com**
2. Sign in with the same Google account
3. Click **"New workspace"**
4. Select **"Blank"** or let your developer start from a template
5. Share access:
   - Click your profile icon → "Manage team"
   - Invite your developer's email address
   - They can now open and work in the same workspace from their browser

> Your developer will connect IDX to the Firebase project using the Firebase CLI and the config object you saved in Step 7.

---

## STEP 11 — Share Access with Your Developer

Give your developer access to the Firebase project:

1. In Firebase Console, click the **gear icon** → **"Project settings"**
2. Click the **"Users and permissions"** tab
3. Click **"Add member"**
4. Enter your developer's email address
5. Select role: **"Editor"** (they can deploy, but not delete the project or billing)
6. Click **"Add"**

Your developer will get an email invitation and can access the Firebase console.

---

## What to Give Your Developer

Send your developer a message with:

```
Hi [Developer Name],

Here is everything you need to start working on KIRIMBA:

1. Firebase Project ID: kirimba-platform-a1b2c
2. Firebase Console: console.firebase.google.com
   - You've been invited — check your email

3. Firebase Config Object:
[paste the config block from Step 7]

4. Google IDX Workspace: [share the IDX workspace link]

5. Technical specification: [attach KIRIMBA_Technical_Spec.md]
6. Build instructions: [attach KIRIMBA_Coding_Agent_Prompts.md]

Please start with Phase 1 in the coding prompts document.
Let me know when you have the Firebase emulator running locally.
```

---

## STEP 12 — Set Up a Custom Domain (Optional — After Pilot Launch)

Once the pilot is running and you're ready for a real URL:

1. Buy a domain: **kirimba.app** or **kirimba.bi** (Burundi domain)
   - Use Google Domains (domains.google.com) or Namecheap
2. In Firebase Hosting → **"Add custom domain"**
3. Enter your domain and follow the verification steps
4. Firebase gives you DNS records to add at your domain registrar
5. Takes 24-48 hours to propagate

---

## Quick Reference: Firebase Console Links

Once your project is created, bookmark these:

| What | URL |
|------|-----|
| Firebase Console | console.firebase.google.com |
| Your project | console.firebase.google.com/project/kirimba-platform-a1b2c |
| Auth users | console.firebase.google.com/project/kirimba-platform-a1b2c/authentication/users |
| Firestore data | console.firebase.google.com/project/kirimba-platform-a1b2c/firestore |
| Functions | console.firebase.google.com/project/kirimba-platform-a1b2c/functions |
| Hosting | console.firebase.google.com/project/kirimba-platform-a1b2c/hosting |
| Usage & billing | console.firebase.google.com/project/kirimba-platform-a1b2c/usage |

*Replace `kirimba-platform-a1b2c` with your actual project ID.*

---

## Understanding Your Monthly Costs (Pilot Phase)

Firebase's free tier (Spark plan) covers:

| Resource | Free Monthly Limit | KIRIMBA at 100 Users |
|----------|--------------------|---------------------|
| Firestore reads | 50,000/day | ~5,000/day ✅ |
| Firestore writes | 20,000/day | ~2,000/day ✅ |
| Firestore storage | 1 GB | < 50 MB ✅ |
| Hosting bandwidth | 10 GB/month | < 1 GB ✅ |
| Cloud Functions | 2M calls/month | < 10,000/month ✅ |

**Estimated monthly bill at pilot scale: $0–$2**

You'll only start paying meaningfully after thousands of daily active users.

---

## If Something Goes Wrong

**Can't create the project:**
- Make sure you're logged into the right Google account
- Try a different browser (Chrome works best with Firebase)

**Payment method rejected:**
- Try a Visa debit card — Firebase accepts most international cards
- Set the budget alert before completing so you can monitor spend

**Developer can't access the project:**
- Check they accepted the email invitation
- Try removing and re-adding them in Users and Permissions

**Any other Firebase issue:**
- Firebase documentation: firebase.google.com/docs
- Firebase status page: status.firebase.google.com

---

*KIRIMBA Firebase Setup Guide v1.0*  
*This guide is for the non-technical founder. Share the spec and prompts files with your developer.*
