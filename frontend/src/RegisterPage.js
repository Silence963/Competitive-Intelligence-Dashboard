import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import './styles/components.css';

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [companyName, setCompanyName] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [region, setRegion] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  
  // Extract userid and firmid from URL
  const [userId, setUserId] = useState(null);
  const [firmId, setFirmId] = useState(null);
  
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const uid = params.get('userid');
    const fid = params.get('firmid');
    if (uid) setUserId(uid);
    if (fid) setFirmId(fid);
  }, [location.search]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);
    
    // Client-side validation to match backend requirements
    if (!companyName.trim() || !industry.trim()) {
      setError('Please fill in all required fields (Company Name and Industry)');
      setLoading(false);
      return;
    }
    try {
      // Make request to backend registration endpoint
      const res = await fetch("http://localhost:5600/api/register-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          companyUrl: companyUrl.trim(),
          industry: industry.trim(),
          region: region.trim() || null,
          contactEmail: contactEmail.trim(),
          facebookUrl: facebookUrl.trim() || null,
          googleUrl: googleUrl.trim() || null,
          linkedinUrl: linkedinUrl.trim() || null,
          instagramUrl: instagramUrl.trim() || null,
          userid: userId,
          firmid: firmId
        }),
      });
      
      const responseData = await res.json();
      
      if (!res.ok) {
        throw new Error(responseData.error || `Registration failed (${res.status})`);
      }
      
      if (responseData.success) {
        setSuccess(true);
        console.log('Company registered successfully with ID:', responseData.companyId);
      } else {
        throw new Error(responseData.error || 'Registration failed');
      }
      setCompanyName("");
      setCompanyUrl("");
      setIndustry("");
      setRegion("");
      setContactEmail("");
      setFacebookUrl("");
      setGoogleUrl("");
      setLinkedinUrl("");
      setInstagramUrl("");
      // Redirect to dashboard with credentials after success
      setTimeout(() => {
        const dashboardUrl = userId && firmId
          ? `/dashboard?userid=${encodeURIComponent(userId)}&firmid=${encodeURIComponent(firmId)}`
          : "/";
        navigate(dashboardUrl, { state: { scrollToCta: !userId || !firmId } });
      }, 1200);
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page-container">
      <div className="register-form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h2 style={{ marginBottom: 0 }}>Register Your Company</h2>
          <button
            type="button"
            className="register-back-btn"
            style={{ background: 'none', color: '#1677ff', border: 'none', fontWeight: 600, fontSize: '1rem', cursor: 'pointer', padding: '0.2rem 0.8rem', borderRadius: '16px', transition: 'background 0.18s' }}
            onClick={() => {
              const backUrl = userId && firmId
                ? `/?userid=${encodeURIComponent(userId)}&firmid=${encodeURIComponent(firmId)}`
                : '/';
              navigate(backUrl);
            }}
          >
            ← Back
          </button>
        </div>
        <form className="register-form" onSubmit={handleSubmit}>
          <label htmlFor="companyName">Company Name<span style={{color: '#ef4444'}}>*</span></label>
          <input
            id="companyName"
            type="text"
            required
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="e.g. Myblocks Inc."
          />
          <label htmlFor="companyUrl">Company Website URL</label>
          <input
            id="companyUrl"
            type="url"
            value={companyUrl}
            onChange={e => setCompanyUrl(e.target.value)}
            placeholder="e.g. https://myblocks.com"
          />
          <label htmlFor="industry">Industry<span style={{color: '#ef4444'}}>*</span></label>
          <input
            id="industry"
            type="text"
            required
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            placeholder="e.g. SaaS, Retail, Healthcare"
          />
          <label htmlFor="region">Region/Location</label>
          <input
            id="region"
            type="text"
            value={region}
            onChange={e => setRegion(e.target.value)}
            placeholder="e.g. New York, USA or London, UK"
          />
          <label htmlFor="contactEmail">Contact Email</label>
          <input
            id="contactEmail"
            type="email"
            value={contactEmail}
            onChange={e => setContactEmail(e.target.value)}
            placeholder="e.g. info@myblocks.com"
          />
          <label htmlFor="facebookUrl">Facebook Page URL</label>
          <input
            id="facebookUrl"
            type="url"
            value={facebookUrl}
            onChange={e => setFacebookUrl(e.target.value)}
            placeholder="e.g. https://facebook.com/yourcompany"
          />
          <label htmlFor="googleUrl">Google Business URL</label>
          <input
            id="googleUrl"
            type="url"
            value={googleUrl}
            onChange={e => setGoogleUrl(e.target.value)}
            placeholder="e.g. https://business.google.com/yourcompany"
          />
          <label htmlFor="linkedinUrl">LinkedIn Page URL</label>
          <input
            id="linkedinUrl"
            type="url"
            value={linkedinUrl}
            onChange={e => setLinkedinUrl(e.target.value)}
            placeholder="e.g. https://linkedin.com/company/yourcompany"
          />
          <label htmlFor="instagramUrl">Instagram Page URL</label>
          <input
            id="instagramUrl"
            type="url"
            value={instagramUrl}
            onChange={e => setInstagramUrl(e.target.value)}
            placeholder="e.g. https://instagram.com/yourcompany"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Registering..." : "Register Company"}
          </button>
        </form>
        {success && <div className="register-success">✅ Company registration successful! Your company has been added to COMPA. You can now add competitors and start generating reports.</div>}
        {error && <div className="register-error">❌ {error}</div>}
      </div>
    </div>
  );
}
