import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./styles/landing.css";

const reports = [
  {
    id: "swot-analysis",
    name: "SWOT Analysis",
    description: "Strengths, Weaknesses, Opportunities, Threats. Provides a comprehensive overview of your company's position in the market and helps identify strategic priorities.",
    benefits: [
      "Identify internal strengths and weaknesses",
      "Spot external opportunities and threats",
      "Guide strategic planning and risk management",
      "Tailor recommendations to current market conditions"
    ]
  },
  {
    id: "competitor-analysis",
    name: "Competitor Analysis",
    description: "Detailed competitor market analysis. Understand your rivals' strengths, weaknesses, and strategies to stay ahead.",
    benefits: [
      "Benchmark against competitors",
      "Discover gaps and opportunities",
      "Inform product and marketing strategy"
    ]
  },
  {
    id: "market-share",
    name: "Market Share Analysis",
    description: "Market share distribution and positioning. Visualize your market position and growth potential.",
    benefits: [
      "Track market share trends",
      "Identify growth opportunities",
      "Monitor competitive threats"
    ]
  },
  {
    id: "content-gap",
    name: "Content Gap Analysis",
    description: "Content opportunities and strategy gaps. Optimize your content strategy for better engagement and reach.",
    benefits: [
      "Find missing content topics",
      "Improve SEO and audience targeting",
      "Boost engagement and conversion"
    ]
  },
  {
    id: "technical-seo",
    name: "Technical SEO Analysis",
    description: "Website performance and SEO comparison. Enhance your site's visibility and technical health.",
    benefits: [
      "Fix technical SEO issues",
      "Increase organic traffic",
      "Improve site speed and usability"
    ]
  },
  {
    id: "ux-comparison",
    name: "UX Comparison",
    description: "User experience and design analysis. Benchmark your UX against competitors for better retention.",
    benefits: [
      "Spot UX pain points",
      "Enhance user satisfaction",
      "Increase conversion rates"
    ]
  },
  {
    id: "pricing-comparison",
    name: "Pricing Comparison",
    description: "Pricing strategies and positioning. Optimize your pricing for competitiveness and profitability.",
    benefits: [
      "Compare pricing models",
      "Find optimal price points",
      "Boost sales and margins"
    ]
  },
  {
    id: "brand-presence",
    name: "Brand Presence Analysis",
    description: "Brand visibility across channels. Strengthen your brand's reach and reputation.",
    benefits: [
      "Audit brand visibility",
      "Improve brand consistency",
      "Grow audience and loyalty"
    ]
  },
  {
    id: "audience-overlap",
    name: "Audience Overlap Analysis",
    description: "Audience segmentation insights. Discover shared and unique audiences for targeted campaigns.",
    benefits: [
      "Segment audiences",
      "Target new customer groups",
      "Increase campaign ROI"
    ]
  },
  {
    id: "30-60-90",
    name: "30-60-90 Plan",
    description: "90-day execution roadmap. Accelerate growth with actionable steps and milestones.",
    benefits: [
      "Set clear goals for 30, 60, and 90 days",
      "Track progress and accountability",
      "Drive rapid business impact"
    ]
  },
  {
    id: "revenue-model-canvas",
    name: "Revenue Model Canvas",
    description: "Monetization & business model. Visualize and optimize your revenue streams.",
    benefits: [
      "Map revenue sources",
      "Spot monetization gaps",
      "Strengthen business model"
    ]
  },
  {
    id: "churn-fix",
    name: "Churn Fix",
    description: "Retention action plan and experiments. Reduce churn and boost customer loyalty.",
    benefits: [
      "Identify churn drivers",
      "Test retention strategies",
      "Increase customer lifetime value"
    ]
  },
  {
    id: "kpi-dashboard-blueprint",
    name: "KPI Dashboard Blueprint",
    description: "Metrics tree and dashboard design. Build effective dashboards for data-driven decisions.",
    benefits: [
      "Design actionable dashboards",
      "Track key metrics",
      "Empower teams with insights"
    ]
  },
  {
    id: "go-to-market-plan",
    name: "Go-to-Market Plan",
    description: "ICP, messaging, channels, and timeline. Launch new products and campaigns successfully.",
    benefits: [
      "Clarify ideal customer profile",
      "Plan launch timeline",
      "Maximize go-to-market impact"
    ]
  },
  {
    id: "value-proposition",
    name: "Value Proposition",
    description: "Differentiation and messaging. Stand out in the market with a compelling value proposition.",
    benefits: [
      "Refine messaging",
      "Highlight unique strengths",
      "Win more customers"
    ]
  },
  {
    id: "pivot-ideas",
    name: "Pivot Ideas",
    description: "Adjacency and pivot options. Explore new directions for growth and innovation.",
    benefits: [
      "Discover adjacent markets",
      "Test new business models",
      "Drive innovation"
    ]
  }
];

const LandingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Extract user and firm ID from URL if present
  const params = new URLSearchParams(location.search);
  const userId = params.get("userid");
  const firmId = params.get("firmid");
  const dashboardUrl = userId && firmId
    ? `/dashboard?userid=${encodeURIComponent(userId)}&firmid=${encodeURIComponent(firmId)}`
    : "/dashboard";

  React.useEffect(() => {
    if (location.state && location.state.scrollToCta) {
      setTimeout(() => {
        const ctaSection = document.querySelector('.landing-cta');
        if (ctaSection) {
          ctaSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }
  }, [location.state]);

  return (
    <div className="landing-container">
      <header className="landing-header" style={{ position: 'relative' }}>
        <h1>Welcome to COMPA</h1>
        <button
          className="register-top-btn"
          style={{ position: 'absolute', top: 24, right: 32, zIndex: 10, padding: '0.7rem 1.5rem', fontSize: '1rem', borderRadius: '24px', background: '#1677ff', color: '#fff', border: 'none', fontWeight: 600, boxShadow: '0 2px 8px rgba(22,119,255,0.07)', cursor: 'pointer', transition: 'background 0.18s' }}
          onClick={() => navigate('/register')}
        >
          Register Company
        </button>
        <p className="landing-subtitle">Your AI-powered business intelligence platform for strategic growth</p>
      </header>
      <section className="landing-intro">
        <h2>What is COMPA?</h2>
        <p>
          COMPA helps you unlock actionable insights, benchmark your business, and accelerate growth with a suite of advanced AI-driven reports. Each report is designed to solve a specific business challenge and deliver measurable results.
        </p>
      </section>
      <section className="landing-reports">
        <h2>Explore Our Reports</h2>
        <div className="reports-grid">
          {reports.map(report => (
            <div key={report.id} className="report-card">
              <h3>{report.name}</h3>
              <p className="report-description">{report.description}</p>
              <ul className="report-benefits">
                {report.benefits.map((benefit, i) => (
                  <li key={i}>{benefit}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      {/* Creative CTA Section */}
      <section className="landing-cta">
        <h2 style={{ color: '#1677ff', marginBottom: 12 }}>Ready to Experience COMPA?</h2>
        <p style={{ color: '#374151', fontSize: '1.15rem', marginBottom: 24 }}>
          Dive into the full application and start your strategic journey!
        </p>
        <button
          className="cta-button"
          onClick={() => navigate(dashboardUrl)}
        >
          <span className="cta-glow">🚀 Launch COMPA Application</span>
        </button>
      </section>
      <section className="landing-benefits">
        <h2>Why Choose COMPA?</h2>
        <ul className="benefits-list">
          <li>All-in-one platform for business analysis</li>
          <li>Easy-to-use, beautiful interface</li>
          <li>Actionable, data-driven recommendations</li>
          <li>Secure and private by design</li>
          <li>Continuous updates and improvements</li>
        </ul>
      </section>
      <footer className="landing-footer">
        <p>© {new Date().getFullYear()} COMPA. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
