import React from 'react';
import {
  Activity, BellRing, Radio, Phone, Mail, ArrowRight, Users,
  TrendingUp, Repeat, Clock, Cpu, MailCheck, ShieldCheck
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import LiveDemo from './LiveDemo';

const FEATURES = [
  {
    icon: Activity,
    title: 'Live & Historical Data',
    description: 'Track every sensor as readings stream in live, then pick any date range to review past performance and spot recurring issues.',
  },
  {
    icon: BellRing,
    title: 'Smart Threshold Alerts',
    description: 'Set a safe high/low range per sensor. Fresh readings are checked every five minutes, with breach and recovery emails.',
  },
  {
    icon: TrendingUp,
    title: 'Drift & Flatline Detection',
    description: 'Statistical checks catch slow multi-day drift and sensors that quietly stop reporting — not just hard threshold breaches.',
  },
  {
    icon: Repeat,
    title: 'Temperature Cycle Insights',
    description: 'Estimates cycling patterns from temperature changes. Assessing rapid cycles requires sufficiently frequent samples and equipment verification.',
  },
  {
    icon: Clock,
    title: 'Routine Learning',
    description: 'Learns each sensor\'s usual daily schedule and flags a setback or cycle that\'s late or missing entirely — not just bad temperatures.',
  },
  {
    icon: Users,
    title: 'Built For Your Team',
    description: 'Rename sensors to match how your team already talks about them, and choose exactly who can see which ones.',
  },
];

const HOW_IT_WORKS = [
  {
    icon: Cpu,
    title: 'Sensors report in',
    description: 'Your ESP32 devices publish readings every few minutes, streamed straight into your dashboard.',
  },
  {
    icon: ShieldCheck,
    title: 'Four checks run automatically',
    description: 'The dashboard analyzes trends and sampled cycles. Configure thresholds for emails; routine learning needs historical events.',
  },
  {
    icon: MailCheck,
    title: 'You get an email',
    description: 'Configured temperature thresholds are checked every five minutes, with a follow-up when fresh readings return to range.',
  },
];

export default function LandingPage({ onSignIn, companyName, companyPhone, companyPhoneHref, companyEmail, logo, isDark, onToggleTheme }) {
  const scrollToDemo = () => {
    document.getElementById('live-demo')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200">
      {/* Nav */}
      <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <img src={logo} alt={`${companyName} logo`} className="w-10 h-10 object-contain shrink-0" />
            <span className="font-bold text-lg text-slate-900 dark:text-slate-100 tracking-tight">{companyName}</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
            <button
              onClick={onSignIn}
              className="bg-slate-900 text-white font-semibold px-4 py-2 rounded-lg hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-900 dark:hover:bg-amber-400 transition-colors text-sm"
            >
              Sign In
            </button>
          </div>
        </div>
      </nav>
      <main>
      {/* Hero */}
      <section className="relative overflow-hidden max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <div className="pointer-events-none absolute inset-x-0 -top-24 flex justify-center -z-10">
          <div className="h-72 w-[36rem] rounded-full bg-amber-400/20 dark:bg-amber-500/10 blur-3xl" />
        </div>
        <div className="inline-flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-900 rounded-full px-3 py-1 mb-6">
          <Radio className="w-3.5 h-3.5" />
          Live HVAC Telemetry, Anywhere
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight max-w-3xl mx-auto">
          Know the problem, before it becomes a problem.
        </h1>
        <p className="mt-6 text-lg text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
          {companyName}'s HVAC monitoring dashboard streams live sensor data from rooftop units, server rooms, and
          coolers so you can catch failures early and keep customers comfortable.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onSignIn}
            className="w-full sm:w-auto bg-slate-900 text-white font-semibold px-6 py-3 rounded-lg hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-900 dark:hover:bg-amber-400 transition-colors flex items-center justify-center gap-2"
          >
            Sign In to Your Dashboard
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={scrollToDemo}
            className="w-full sm:w-auto bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold px-6 py-3 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
          >
            See Live Demo
          </button>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-500" /> Statistical insights plus configured threshold alerts</span>
          <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" /> Checked every 5 minutes, day and night</span>
          <span className="flex items-center gap-2"><MailCheck className="w-4 h-4 text-amber-500" /> Resolved alerts emailed too, so you know it's over</span>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-slate-700 dark:text-slate-300" />
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 sm:p-10 border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 text-center mb-10">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(({ icon: Icon, title, description }, index) => (
              <div key={title} className="text-center">
                <div className="relative w-12 h-12 mx-auto bg-slate-900 dark:bg-amber-500 rounded-full flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-white dark:text-slate-900" />
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center justify-center">
                    {index + 1}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Live Demo */}
      <section id="live-demo" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-full px-3 py-1 mb-4">
            Simulated data · No login required
          </div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Try the dashboard yourself</h2>
          <p className="mt-3 text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Pick an example and watch a few hours of simulated readings replay in seconds, including the alert
            emails your team would get.
          </p>
        </div>
        <LiveDemo isDark={isDark} />
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="bg-slate-900 rounded-2xl px-8 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">Ready to monitor your HVAC systems?</h2>
          <p className="mt-3 text-slate-300 max-w-lg mx-auto">
            Sign in with your {companyName} account to see live data from your own sensors.
          </p>
          <button
            onClick={onSignIn}
            className="mt-6 bg-amber-500 text-slate-900 font-semibold px-6 py-3 rounded-lg hover:bg-amber-400 transition-colors"
          >
            Sign In
          </button>
        </div>
      </section>

      </main>
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
          <span>© {new Date().getFullYear()} {companyName}. All rights reserved.</span>
          <div className="flex flex-wrap justify-center items-center gap-x-5 gap-y-3">
            <a href={companyPhoneHref} className="flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition-colors">
              <Phone className="w-4 h-4" />
              {companyPhone}
            </a>
            <a href={`mailto:${companyEmail}`} className="flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition-colors">
              <Mail className="w-4 h-4" />
              {companyEmail}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
