<div align="center">

<img src="https://cldup.com/3DOgOVrIWN.png" alt="EaseLMS Logo" width="300" />

**The Modern Open-Source Learning Management System**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://opensource.org/licenses/AGPL-3.0)
[![Next.js](https://img.shields.io/badge/Next.js-16.0-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Enabled-green?logo=supabase)](https://supabase.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

[Features](#-features) • [Quick Start](#-quick-start) • [Documentation](https://docs.easelms.org) • [Hosted Service](#-hosted-service) • [Contributing](#-contributing)

</div>

---

<div align="center">
<img src="https://cldup.com/g7W7DHpIxf.png" alt="EaseLMS Product Screenshot" width="100%" />
</div>

## 🎯 Overview

EaseLMS is a modern, open-source Learning Management System built with Next.js, TypeScript, and Supabase. It provides a complete solution for creating, managing, and delivering online courses with features like video lessons, interactive quizzes, progress tracking, certificates, and payment integration.

### Why EaseLMS?

- 🚀 **Modern Stack** - Built with Next.js 16, React 19, and TypeScript
- 🎨 **Beautiful UI** - Modern, responsive design with dark mode support
- 🔒 **Secure** - Built-in authentication, role-based access control, and data encryption
- 💰 **Monetization Ready** - Integrated payment processing (Stripe, Flutterwave)
- 📱 **Mobile First** - Fully responsive design that works on all devices
- 🎓 **Feature Rich** - Courses, quizzes, certificates, analytics, and more
- 🔧 **Self-Hostable** - Complete control over your data and infrastructure
- 🌍 **Open Source** - Free to use, modify, and distribute

---

## ✨ Features

### Course Management
- 📚 Create unlimited courses with rich content editor
- 🎥 Video lessons with progress tracking
- 📄 Document resources (PDF, DOC, images)
- 🔗 Course prerequisites and dependencies
- 🏷️ Course categories and tags
- 📊 Course analytics and enrollment tracking
- 💰 Multiple enrollment modes (free, paid, recurring, closed)
- 🎬 Preview videos for course marketing

### Learning Experience
- 📱 Mobile-responsive course player
- ⏯️ Video playback with progress saving
- ✅ Interactive quizzes with multiple question types
- 📈 Real-time progress tracking
- 🏆 Achievement badges and certificates
- 💬 Discussion and support features
- 📋 Lesson resources and downloadable materials

### Admin & Instructor Tools
- 👥 User management (Admin, Instructor, Learner roles)
- 📊 Comprehensive analytics dashboard
- 💳 Purchase and payment management
- 🎨 Custom branding and theming
  - Platform name and description
  - Custom logos (light and dark mode)
  - Favicon customization
  - SEO metadata (title, description, keywords, image)
- ⚙️ Flexible course settings and enrollment modes
- 📧 Email notifications (SendGrid integration)
  - Welcome emails for new users
  - Course enrollment confirmations
  - Course completion notifications
  - Certificate ready notifications
  - Payment confirmations and failure alerts
  - Admin notifications for enrollments, payments, and completions
- 🔐 Role-based access control

### Payment Integration
- 💳 Stripe integration for global payments
- 🌍 Flutterwave for African markets
- 💱 Multi-currency support
- 💰 One-time and recurring payment options
- 📦 Purchase history and receipts
- 🔄 Payment webhook handling

### Certificates
- 🎓 Automated certificate generation
- ✍️ Custom certificate templates
- 🔏 Digital signatures
- 📄 PDF export
- 🏅 Completion and achievement certificates

### Developer Experience
- 🔧 TypeScript for type safety
- 📦 Monorepo structure with Turborepo
- 🎨 shadcn/ui component library
- 🧪 Well-structured, maintainable codebase

---

## 🛠️ Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **UI Library:** [React 19](https://react.dev/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Components:** [Radix UI](https://www.radix-ui.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **Database:** [Supabase](https://supabase.com/) (PostgreSQL)
- **Authentication:** Supabase Auth
- **File Storage:** [Supabase Storage](https://supabase.com/docs/guides/storage)
- **State Management:** [TanStack Query](https://tanstack.com/query)
- **Forms:** [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/)
- **Payments:** [Stripe](https://stripe.com/) & [Flutterwave](https://flutterwave.com/)
- **Email Service:** [SendGrid](https://sendgrid.com/)
- **PDF Generation:** [PDFKit](https://pdfkit.org/)
- **Video Player:** [Media Chrome](https://www.media-chrome.org/)
- **Monorepo:** [Turborepo](https://turbo.build/)

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0 or higher
- npm 10.0 or higher
- A Supabase account (free tier works)
- SendGrid account (for email notifications, optional)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/enyojoo/easelms.git
   cd easelms
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file in `apps/lms/`:
   ```env
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

   # Supabase Storage (file uploads - defaults shown, optional)
   NEXT_PUBLIC_SUPABASE_PUBLIC_MEDIA_BUCKET=public-media
   NEXT_PUBLIC_SUPABASE_CERTIFICATES_BUCKET=certificates
   NEXT_PUBLIC_MAX_IMAGE_SIZE_MB=5
   NEXT_PUBLIC_MAX_DOCUMENT_SIZE_MB=25
   NEXT_PUBLIC_MAX_VIDEO_SIZE_MB=50

   # Payment Gateways (optional)
   STRIPE_SECRET_KEY=your_stripe_secret_key
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
   FLUTTERWAVE_SECRET_KEY=your_flutterwave_secret_key
   NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY=your_flutterwave_public_key

   # Exchange Rates (optional - uses exchangerate-api.com)
   EXCHANGERATE_API_KEY=your_exchangerate_api_key

   # Email Notifications (SendGrid)
   SENDGRID_API_KEY=your_sendgrid_api_key
   SENDGRID_FROM_EMAIL=noreply@yourdomain.com
   SENDGRID_FROM_NAME=EaseLMS
   SENDGRID_REPLY_TO=support@yourdomain.com

   # AI quiz generation (optional; server-only)
   ANTHROPIC_API_KEY=your_anthropic_api_key
   AI_QUIZ_MODEL=claude-sonnet-5-5
   AI_COURSE_MODEL=claude-sonnet-5-5
   AI_COURSE_FAST_MODEL=claude-haiku-5-5
   # Optional comma-separated domain allowlist for course import
   COURSE_IMPORT_ALLOWED_DOMAINS=

   # App URL
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

   AI quiz generation requires Node.js 22 or later. Also configure these server-only variables in the
   Netlify site's environment settings and redeploy. The model defaults to
   `claude-sonnet-5-5` if `AI_QUIZ_MODEL` is omitted; it must be available to
   the configured Anthropic account. Generating sends the lesson title, text
   and optional notes to Anthropic. Video is not sent or watched. Admins must
   review and select generated questions before adding them to a quiz.

4. **Set up Supabase Database**
   
   a. **Create a Supabase Project**
      - Go to [supabase.com](https://supabase.com) and sign up/login
      - Click "New Project"
      - Choose your organization, enter project name, database password, and region
      - Wait for the project to be created (takes ~2 minutes)
   
   b. **Get your Supabase credentials**
      - Go to Project Settings → API
      - Copy your `Project URL` (this is your `NEXT_PUBLIC_SUPABASE_URL`)
      - Copy your `anon` `public` key (this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
      - Copy your `service_role` `secret` key (this is your `SUPABASE_SERVICE_ROLE_KEY`)
      - Update your `.env.local` file with these values
   
   c. **Run the database migration**
      - In your Supabase project, go to SQL Editor
      - Click "New Query"
      - Open the file `apps/lms/supabase/migrations/database_setup.sql` from this repository
      - Copy the entire contents of the file
      - Paste it into the SQL Editor
      - Click "Run" (or press Cmd/Ctrl + Enter)
      - Wait for the migration to complete (you should see "Success. No rows returned")
   
   d. **Verify the migration**
      - Go to Table Editor in Supabase
      - You should see all the tables created: `profiles`, `courses`, `lessons`, `enrollments`, `progress`, `payments`, `certificates`, `instructors`, `resources`, `quiz_questions`, `quiz_settings`, `quiz_attempts`, `quiz_results`, `course_instructors`, `course_prerequisites`, `lesson_resources`, and `platform_settings`

   e. **Configure signup confirmation**
      - In Supabase Authentication → URL Configuration, set the Site URL to the LMS origin (for example, `https://your-lms.example.com`, without a trailing slash).
      - In Authentication → Email Templates → Confirm signup, use a confirmation link of `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}`. The template in `apps/lms/supabase/email-templates/confirm-email.html` shows how to use this link.
      - Deploy the LMS before changing the template. The confirmation page requires a button click before consuming the single-use token, preventing email scanners from consuming it by simply opening the link.
      - Existing confirmation links do not change; request a fresh email at `/auth/confirm` after updating the template. Confirm that the database setup and profile-creation trigger are installed before accepting signups.
      - Admins can open Account actions on a learner's detail page or in Settings user/team management to reset an existing account's password or resend confirmation to an unconfirmed auth email. Share reset passwords securely; they are not emailed. A password reset does not confirm an email. Admin-created accounts are already confirmed and no signup email is sent; users without an account must sign up first. Supabase Auth email delivery and rate limits apply.

   f. **Configure quiz results for an existing database**
      - Apply `apps/lms/supabase/migrations/20261121010000_protect_quiz_results.sql` in the Supabase SQL Editor. This prevents learners from writing quiz results directly; the server grades and records them.
      - Configure `SUPABASE_SERVICE_ROLE_KEY` on the LMS server. Never expose this key to the browser. The quiz-results and certificate routes require it.
      - Each quiz can optionally override the course minimum passing score. New completions and certificates require a passing result for every enabled quiz; previously issued certificates are unchanged.

   g. **Add lesson levels**
      - Apply `apps/lms/supabase/migrations/20261122000000_lesson_levels.sql` in the Supabase SQL Editor before running this version of the LMS. Existing lessons start with no levels.
      - Editors can select any combination of Beginner, Intermediate and Advanced for each lesson. Course badges show the union of lesson levels, and the lowest selected level sets the AI quiz generator's initial difficulty; editors can override it.

   h. **Enable admin assignments and cancellation**
      - Apply `apps/lms/supabase/migrations/20261122010000_cancelled_enrollment_access.sql` before deploying the matching application code. It updates row-level security policies and routes enrolment updates through the server.
      - Admins can add teachers or admins and assign published courses from Learner Management. CSV imports use `name,email,role` (role is optional: `teacher` or `admin`); review the preview before importing.
      - Generated passwords are shown once or included in the downloadable import results. Transfer them securely and delete the results file when no longer needed. Assignments work without SendGrid; notifications require `SENDGRID_API_KEY`.
      - Cancelling retains lesson progress and prevents further access through the LMS. Content already downloaded, cached or available through a public external video URL cannot be recalled. Reassigning restores the existing enrolment and its progress.

   i. **Set up Supabase Storage and certificate defaults**
      - Apply `apps/lms/supabase/migrations/20261122020000_supabase_storage.sql` in the Supabase SQL Editor. It creates the `public-media` (public read) and `certificates` (private) buckets, locks writes to the server, adds platform-wide certificate defaults to `platform_settings`, and enables certificates by default on new courses.
      - File uploads go straight from the browser to Supabase Storage using signed upload URLs issued by the server. Only admins can upload course content; any signed-in user can upload their own profile picture.
      - Size limits default to 5 MB for images, 25 MB for documents and 50 MB for videos (the largest single file on the Supabase free plan). Larger videos should be uploaded to YouTube (unlisted) and embedded by link.
      - Platform-wide certificate templates, descriptions, additional text and the default signature are edited under Settings → Certificates. Certificate descriptions support the placeholders `[Student Name]`, `[Course Name]`, `[Grade]` and `[PD Hours]`.

   j. **Enable course import**
      - Apply `apps/lms/supabase/migrations/20261122030000_course_imports.sql` in the Supabase SQL Editor after the lesson levels and storage migrations. It adds `source_url`, `pd_hours`, import history and service-role-only transactional import functions.
      - Set `ANTHROPIC_API_KEY` and, optionally, `AI_COURSE_MODEL` and `AI_COURSE_FAST_MODEL` in the LMS server environment and Netlify. Their defaults are `claude-sonnet-5-5` and `claude-haiku-5-5`; both models must be available to the Anthropic account. These values are server-only. Course and lesson source text is sent to Anthropic; never import confidential material or material you lack permission to use.
      - Optionally set `COURSE_IMPORT_ALLOWED_DOMAINS` to a comma-separated list of permitted hosts. LearnFree imports require both `learnfree.org` and `api.one81.com`; YouTube metadata and duration lookup require `youtube.com`, and shortened links also require `youtu.be`. The allowlist applies to redirects and all source requests.
      - Admins can create a course from a URL on the Courses page after confirming permission for automated retrieval, AI processing, linking and embedding. LearnFree's published terms restrict automated extraction; obtain separate permission before importing it. AI output can be inaccurate and should be reviewed in the editor after publication.
      - Imports are limited to 40 entries and five per admin per hour. Progress can be resumed after a refresh. A source-only quiz is included without an embedded video or generated quiz. If the owner cannot be identified, the credit is omitted and the import reports a warning.
      - AI-driven steps can take up to 50 seconds each. Source fetches have an 8.5-second limit per attempt and retry timeouts up to twice. If a step still fails, resume the import to retry it.
      - The preview is recorded in the browser; leave the page open. Longer courses produce longer previews. If recording or upload fails, the course is published without a preview and the warning remains in the import history.
      - Direct YouTube video imports inspect the public description for timestamps and offer a choice between the suggested lessons and one full-video lesson. An introduction immediately before numbered modules is included in the first module. Each lesson embeds the corresponding start and end times. No transcript is imported: add lesson content, levels and quizzes manually and review AI-generated course details.
      - To replace the single lesson of an existing YouTube-sourced course, first apply `apps/lms/supabase/migrations/20261123010000_youtube_chapter_replacement.sql`, then select **Review video chapters** on the course. Confirming replaces the old lesson and its content, quizzes and resource links; it is blocked if the course has learner enrolments or activity. Published courses change immediately. Review the existing course preview and certificate after replacement.

   k. **Enable course splitting**
      - Apply `apps/lms/supabase/migrations/20261122040000_course_splits.sql` in the Supabase SQL Editor after the course-import migration.
      - Admins can choose **Split into sections** on a course or completed import. Suggestions group lessons in their existing order, not by topic; review and adjust the titles, lesson assignments and levels before creating the separate draft courses. The original course, its enrollments and progress are not changed.
      - Each draft copies the saved lessons, quizzes and linked resources, retains the original enrollment settings, and has its own calculated PD credit and certificate. Review each draft and publish it when ready.
      - Keep the page open while each section's preview is recorded and uploaded. If media generation fails or the page is refreshed, return to the split page and resume; drafts already created are retained.

5. **Start the development server**
   ```bash
   npm run dev
   ```
   
   This will start both applications:
   - **LMS Application**: [http://localhost:3000](http://localhost:3000) (apps/lms)
   - **Website**: [http://localhost:3001](http://localhost:3001) (apps/website)

6. **Open your browser**
   
   Navigate to [http://localhost:3000](http://localhost:3000) for the LMS application

### First Admin User

After setting up the database, create your first admin user through the Supabase dashboard or by using the signup API endpoint.

### Customize Branding

Once logged in as an admin, navigate to **Settings → Brand** to customize your platform:
- Set your platform name and description
- Upload custom logos for light and dark modes
- Set a custom favicon
- Configure contact email and app URL (used in email templates)
- Configure SEO metadata (title, description, keywords, and image)

These settings will automatically update across your entire platform, including the logo in the sidebar, favicon in browser tabs, email templates, and SEO tags for better search engine visibility.

### Email Notifications

EaseLMS includes a comprehensive email notification system powered by SendGrid. The following emails are automatically sent:

**User Emails:**
- **Welcome Email** - Sent when a new user signs up
- **Enrollment Confirmation** - Sent when a user enrolls in a course
- **Course Completion** - Sent when a user completes a course
- **Certificate Ready** - Sent when a certificate is generated
- **Payment Confirmation** - Sent when a payment is successful
- **Payment Failed** - Sent when a payment fails

**Admin Emails:**
- **New Enrollment Notification** - Sent to admins when a new enrollment occurs
- **New Payment Notification** - Sent to admins when a payment is received
- **Course Completion Notification** - Sent to admins when a course is completed

All emails use your platform's branding (name, logo, contact email, and app URL) configured in Settings → Brand. Emails support both light and dark mode based on the recipient's email client preferences.

**Setup:**
1. Create a SendGrid account at [sendgrid.com](https://sendgrid.com)
2. Generate an API key in SendGrid dashboard
3. Add `SENDGRID_API_KEY` to your `.env.local` file
4. Optionally configure `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`, and `SENDGRID_REPLY_TO`

---

## 📖 Contributing

- [Contributing Guide](CONTRIBUTING.md)

---

## 🏗️ Project Structure

EaseLMS is a monorepo containing two main applications:

```
easelms/
├── apps/
│   ├── lms/              # Main LMS application (deploy this for the learning platform)
│   │   ├── app/          # Next.js app router pages
│   │   │   ├── admin/    # Admin dashboard pages
│   │   │   ├── learner/  # Learner-facing pages
│   │   │   ├── api/      # API routes
│   │   │   └── auth/     # Authentication pages
│   │   ├── components/   # React components
│   │   ├── lib/          # Utilities and helpers
│   │   │   ├── storage/  # Supabase Storage integration
│   │   │   ├── certificates/ # Certificate generation
│   │   │   ├── payments/ # Payment processing
│   │   │   └── supabase/ # Supabase utilities
│   │   ├── hooks/        # Custom React hooks
│   │   ├── utils/        # Utility functions
│   │   └── supabase/     # Database migrations
│   └── website/          # Landing page website (deploy this for marketing site)
│       ├── app/          # Next.js app router pages
│       └── components/   # Landing page components
├── components/           # Shared components
├── package.json          # Root package.json
└── turbo.json           # Turborepo configuration
```

**Applications:**
- **`apps/lms`** - The main Learning Management System application. Deploy this for your course platform.
- **`apps/website`** - The marketing landing page. Deploy this separately for your public-facing website.

---

## 🌐 Hosted Service

Don't want to manage infrastructure? We offer a fully managed hosted service with:

- ✅ **Zero Setup** - Get started in minutes, not weeks. We handle all the infrastructure setup and configuration
- ✅ **Managed Infrastructure** - We manage servers, databases, backups, and updates so you can focus on your content
- ✅ **Security & Compliance** - Enterprise-grade security with regular updates, SSL certificates, and compliance standards
- ✅ **Professional Support** - Get help when you need it with priority support and dedicated account management
- ✅ **Automatic Backups** - Your data is automatically backed up daily with point-in-time recovery options
- ✅ **Scalable Infrastructure** - Scale seamlessly as your learner base grows without worrying about infrastructure limits

**Learn more about our hosted service, including pricing plans and features:** [https://www.easelms.org/hosted](https://www.easelms.org/hosted)

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### How to Contribute

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Setup

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run linting
npm run lint

# Build for production
npm run build
```

---

## 📝 License

This project is licensed under the **AGPL-3.0 License** - see the [LICENSE](LICENSE) file for details.

### Using EaseLMS

**For Your Own Use (Self-Hosting):**
- ✅ You can freely download, install, and use EaseLMS for your own organization
- ✅ You can modify the code to fit your needs
- ✅ No restrictions on internal use - use it privately within your organization

**Commercial Use & Distribution:**
- ✅ You can use EaseLMS commercially (e.g., offer courses for sale)
- ✅ You can modify and distribute EaseLMS
- ⚠️ **Important:** If you modify EaseLMS and provide it as a hosted service (SaaS), you must make your modifications available under AGPL-3.0
- ⚠️ If you want to create a proprietary hosted service without sharing modifications, you'll need a commercial license

**Commercial License:**
If you need to use EaseLMS in a proprietary application or provide a hosted service without open-sourcing your modifications, commercial licenses are available. <a href="https://www.easelms.org/contact" target="_blank" rel="noopener noreferrer">Contact us</a> for more information.

---

## 🆘 Support

- 📧 [Email Support](mailto:support@novaviewconsulting.com)
- 📚 [Documentation](https://docs.easelms.org)
- 💬 [Contact Us](https://www.easelms.org/contact) - Schedule a meeting or send us a message
- 🐦 [Twitter (X)](https://x.com/enyosaam) - Follow us for updates

---

## 🗺️ Roadmap

- [ ] Mobile app (React Native)
- [ ] Advanced analytics and reporting
- [ ] SCORM compliance
- [ ] Live video conferencing integration
- [ ] AI-powered course recommendations
- [ ] Multi-language support
- [ ] Advanced quiz types (drag-and-drop, matching, etc.)
- [ ] Learning paths and curriculum builder

---

<div align="center">

**Made with ❤️ to power learning**

<a href="https://www.easelms.org" target="_blank" rel="noopener noreferrer">Website</a> • <a href="https://x.com/enyosaam" target="_blank" rel="noopener noreferrer">Twitter (X)</a>

</div>
