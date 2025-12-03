import React, { useState, useEffect, useRef, useCallback } from "react";
import "../styles/components.css";
import { marked } from "marked";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import "../fonts/PlayfairDisplaySC-Regular-normal.js";
import "../fonts/PlayfairDisplay-VariableFont_wght-normal.js";
import "../fonts/PlayfairDisplay-SemiBold-normal.js";
import "../fonts/PlayfairDisplay-Medium-normal.js";
// API Manager modal component
import ApiKeyManager from "../API_manager/ApiKeyManager";
// Centralized API client

// State for previous action plans modal
// (moved below imports)

const API_BASE = "http://localhost:5600/api";

const SocialMediaSwot = () => {
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [swot, setSwot] = useState(null);
  // Add these missing state variables
  const [showActionPlanModal, setShowActionPlanModal] = useState(false);
  const [showApiManager, setShowApiManager] = useState(false);
  const [isAddingCompetitor, setIsAddingCompetitor] = useState(false);
  
  // Sidebar collapsible sections state
  const [reportsExpanded, setReportsExpanded] = useState(true);
  const [competitorsExpanded, setCompetitorsExpanded] = useState(true);
  const [actionPlansExpanded, setActionPlansExpanded] = useState(true);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  // --- Saved Action Plans Modal State and Functions ---
  const [showSavedActionPlansModal, setShowSavedActionPlansModal] = useState(false);
  const [savedActionPlans, setSavedActionPlans] = useState([]);
  const [loadingSavedActionPlans, setLoadingSavedActionPlans] = useState(false);
  const [selectedSavedActionPlan, setSelectedSavedActionPlan] = useState(null);

  // Function to fetch all saved action plans for a competitor
  const fetchSavedActionPlans = async () => {
    if (!selectedCompany || !selectedActionCompetitor) {
      showNotification("Select company and competitor first", "error");
      return;
    }
    setLoadingSavedActionPlans(true);
    try {
      const resp = await fetch(`${API_BASE}/get-action-plans?companyId=${selectedCompany}&competitorId=${selectedActionCompetitor}&userid=${userID}&firmid=${firmID}`);
      const data = await resp.json();
      if (data.success && Array.isArray(data.plans)) {
        setSavedActionPlans(data.plans);
      } else {
        setSavedActionPlans([]);
      }
    } catch (err) {
      setSavedActionPlans([]);
      showNotification("Failed to load saved action plans.", "error");
    } finally {
      setLoadingSavedActionPlans(false);
    }
  };

  // Open saved action plans modal
  const openSavedActionPlansModal = () => {
    setShowSavedActionPlansModal(true);
    setSelectedSavedActionPlan(null);
    fetchSavedActionPlans();
  };

  // IDs dynamically derived from URL query (?userid=...&firmid=...)
  const [userID, setUserID] = useState(null);
  const [firmID, setFirmID] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qUser = params.get('userid');
    const qFirm = params.get('firmid');
    if (qUser) setUserID(qUser);
    if (qFirm) setFirmID(qFirm);
  }, []);

  const [showCompetitorsModal, setShowCompetitorsModal] = useState(false);
  const [competitors, setCompetitors] = useState([]);

  const [showAddCompetitorModal, setShowAddCompetitorModal] = useState(false);
  const [newCompetitor, setNewCompetitor] = useState({
    name: "",
    website: "",
    industry: "",
    region: "",
    facebookUrl: "",
    linkedinUrl: "",
    instagramUrl: "",
    googleMapsUrl: "",
    googleReviewUrl: ""
  });

  // Preferences logic
  const [preferences, setPreferences] = useState([]); // All preferences for the company
  const [selectedPreferenceId, setSelectedPreferenceId] = useState(null); // The selected preference for SWOT
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);
  const [showCreatePreferenceModal, setShowCreatePreferenceModal] = useState(false);
  const [createPrefForm, setCreatePrefForm] = useState({
    name: "",
    timeRange: "weekly",
    competitorIds: [],
  });
  const [availableCompetitors, setAvailableCompetitors] = useState([]);
  const [savingPreference, setSavingPreference] = useState(false);
  const [editPrefForm, setEditPrefForm] = useState(null); // null or { ...pref }
  const [showEditPreferenceModal, setShowEditPreferenceModal] = useState(false);
  const [savingEditPreference, setSavingEditPreference] = useState(false);
  const [showReportDropdown, setShowReportDropdown] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportResult, setReportResult] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);

  // Modal for missing requirements
  const [showMissingInfoModal, setShowMissingInfoModal] = useState(false);
  const [missingInfoMessage, setMissingInfoMessage] = useState("");
  // Export all reports progress modal
  const [showExportProgress, setShowExportProgress] = useState(false);
  const [exportProgressMsg, setExportProgressMsg] = useState("");

  // Saved Reports modal
  const [showSavedReportsModal, setShowSavedReportsModal] = useState(false);
  const [savedReports, setSavedReports] = useState([]);
  const [loadingSavedReports, setLoadingSavedReports] = useState(false);
  const [selectedSavedReport, setSelectedSavedReport] = useState(null);

  // Modal refs
  const preferencesModalRef = useRef(null);
  const createPreferenceModalRef = useRef(null);
  const editPreferenceModalRef = useRef(null);
  const addCompetitorModalRef = useRef(null);

  // Notification state
  const [notification, setNotification] = useState({ message: '', type: '', visible: false });
  const notificationTimeoutRef = useRef(null);

  // Show notification helper
  const showNotification = (message, type = 'success') => {
    setNotification({ message, type, visible: true });
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification((n) => ({ ...n, visible: false }));
    }, 3000);
  };

  // Function to fetch previous action plans
  const fetchPreviousActionPlans = async () => {
    if (!selectedCompany || !selectedActionCompetitor) return;
    setLoadingActionPlan(true);
    try {
      const resp = await fetch(`${API_BASE}/get-action-plans?companyId=${selectedCompany}&competitorId=${selectedActionCompetitor}&userid=${userID}&firmid=${firmID}`);
      const data = await resp.json();
      if (data.success && Array.isArray(data.plans) && data.plans.length > 0) {
        // Load the most recent plan (first in the array since it's ordered by CREATED_AT DESC)
        const mostRecentPlan = data.plans[0];
        console.log('Most recent plan:', mostRecentPlan);
        
        // Extract content from USER_INPUT field which contains the actual action plan content
        let planContent = '';
        
        if (mostRecentPlan.USER_INPUT && mostRecentPlan.USER_INPUT.trim()) {
          // The USER_INPUT now contains the direct action plan content (not JSON)
          planContent = mostRecentPlan.USER_INPUT;
        } else {
          planContent = mostRecentPlan.STEP_ACTION || 'No action plan content available.';
        }
        
        console.log('Extracted plan content:', planContent);
        setActionPlan({ content: planContent });
        setShowActionPlanModal(true);
        showNotification('Previous action plan loaded successfully!', 'success');
      } else {
        showNotification('No previous action plans found for this competitor.', 'info');
      }
    } catch (err) {
      console.error('Error fetching previous action plans:', err);
      showNotification('Failed to load previous action plans.', 'error');
    } finally {
      setLoadingActionPlan(false);
    }
  };

  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        // Include userid and firmid in the request
        const url = `http://localhost:5600/competitors?userid=${encodeURIComponent(userID || '')}&firmid=${encodeURIComponent(firmID || '')}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const companiesData = Array.isArray(data) ? data : [];
        setCompanies(companiesData);
        
        // Auto-select the first company if available
        if (companiesData.length > 0 && !selectedCompany) {
          setSelectedCompany(companiesData[0].id);
        }
      } catch (error) {
        console.error("❌ Error fetching companies:", error);
        showNotification("Failed to load companies. Please try again.", "error");
        setCompanies([]);
      }
    };

    // Only fetch if we have credentials
    if (userID && firmID) {
      fetchCompanies();
    }
  }, [userID, firmID, selectedCompany]);

  // (Optional) Could display a banner if tenant IDs missing

  // Load preferences when company changes or when opening the Edit SWOT Preferences modal
  const loadPreferences = useCallback(async (companyId) => {
    try {
  const response = await fetch(`${API_BASE}/load-preferences/${companyId}?userid=${encodeURIComponent(userID||'')}&firmid=${encodeURIComponent(firmID||'')}`);
      const data = await response.json();
      if (data.success) {
        // Map all fields from the DB
        const mappedPrefs = data.preferences.map(row => ({
          prefId: row.PREF_ID || row.prefId,
          companyId: row.COMPANY_ID || row.companyId,
          name: row.NAME || row.name,
          prefType: row.PREF_TYPE || row.prefType,
          timeRange: row.TIME_RANGE || row.timeRange,
          competitorIds: row.COMPETITOR_IDS ? (Array.isArray(row.COMPETITOR_IDS) ? row.COMPETITOR_IDS : JSON.parse(row.COMPETITOR_IDS)) : (row.competitorIds || []),
        }));
        setPreferences(mappedPrefs);
        // Only auto-select if no preference is currently selected
        if (mappedPrefs.length > 0 && !selectedPreferenceId) {
          setSelectedPreferenceId(mappedPrefs[mappedPrefs.length - 1].prefId);
        } else if (mappedPrefs.length === 0) {
          setSelectedPreferenceId(null);
        }
        // If a preference was selected but is no longer in the list, clear the selection
        else if (selectedPreferenceId && !mappedPrefs.find(p => p.prefId === selectedPreferenceId)) {
          setSelectedPreferenceId(null);
        }
      }
    } catch (err) {
      console.error("❌ Error loading preferences:", err);
    }
  }, [selectedPreferenceId, userID, firmID]);

  // When company changes, load preferences and select the most recent one
  useEffect(() => {
    if (selectedCompany) {
      loadPreferences(selectedCompany);
    } else {
      setPreferences([]);
      setSelectedPreferenceId(null);
    }
  }, [selectedCompany, loadPreferences, userID, firmID]);

  // Helper to close all modals/dropdowns
  const closeAllPopups = () => {
    setShowReportDropdown(false);
    setShowAddCompetitorModal(false);
    setShowCompetitorsModal(false);
    setShowPreferencesModal(false);
    setShowCreatePreferenceModal(false);
    setShowEditPreferenceModal(false);
    setShowReportModal(false);
    setShowMissingInfoModal(false);
    setShowExportProgress(false);
    setShowActionPlanModal(false);
    // Do not close API Manager here; it has its own close
  };

  // Preferences modal handler - UPDATED VERSION
  // (Removed duplicate declaration of openPreferencesModal)

  // Validation for required info before generating SWOT
  const validateSWOTRequirements = () => {
    const missing = [];
    if (!selectedCompany) missing.push("Select a company");
    if (!selectedPreferenceId) missing.push("Select a SWOT preference");
    // Optionally, check for competitors if required
    // if (preferences.length > 0 && (preferences.find(p => p.prefId === selectedPreferenceId)?.competitorIds?.length === 0)) missing.push("Add at least one competitor to the preference");
    return missing;
  };

  const fetchSWOT = async () => {
    const missing = validateSWOTRequirements();
    if (missing.length > 0) {
      setMissingInfoMessage("To generate a SWOT Analysis, please: \n- " + missing.join("\n- "));
      setShowMissingInfoModal(true);
      return;
    }

    const selectedPref = preferences.find(p => p.prefId === selectedPreferenceId);
    if (!selectedPref) return alert("Select a preference first");

    try {
      const response = await fetch(`${API_BASE}/generate-report/swot-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompany,
          competitorIds: selectedPref.competitorIds || [],
          userid: userID,
          firmid: firmID,
          // timeRange retained for future backend enhancements if needed
          timeRange: selectedPref.timeRange
        })
      });
      const data = await response.json();
      if(data?.report?.content){
        // Attempt parsing SWOT JSON from model content if it looks like JSON
        try {
          const parsed = JSON.parse(data.report.content);
          setSwot(parsed);
        } catch {
          setSwot(data.report.content);
        }
      } else if (data?.report) {
        setSwot(data.report);
      } else {
        setSwot('No SWOT data returned');
      }
      console.log('✅ SWOT generated via unified endpoint');
    } catch (err) {
      console.error('❌ Error generating SWOT via unified endpoint', err);
      setSwot('Error generating SWOT');
    }
  };

  // Function to fetch saved reports
  const fetchSavedReports = async () => {
    if (!selectedCompany) {
      showNotification("Please select a company first", "error");
      return;
    }
    
    setLoadingSavedReports(true);
    try {
      const response = await fetch(
        `${API_BASE}/saved-reports?userid=${userID}&firmid=${firmID}&companyId=${selectedCompany}`
      );
      if (!response.ok) throw new Error('Failed to fetch saved reports');
      const data = await response.json();
      setSavedReports(data.reports || []);
    } catch (error) {
      console.error("Error fetching saved reports:", error);
      showNotification("Failed to load saved reports. Please try again.", "error");
    } finally {
      setLoadingSavedReports(false);
    }
  };

  // Open saved reports modal
  const openSavedReportsModal = () => {
    if (!selectedCompany) {
      showNotification("Please select a company first", "error");
      return;
    }
    setShowSavedReportsModal(true);
    fetchSavedReports();
  };

  // Fix: View Competitors button handler
  const openCompetitorsModal = async () => {
    if (!selectedCompany) {
      showNotification("Select a company first", "error");
      return;
    }
    try {
  const response = await fetch(`${API_BASE}/view-competitors/${selectedCompany}?userid=${encodeURIComponent(userID||'')}&firmid=${encodeURIComponent(firmID||'')}`);
      if (!response.ok) throw new Error('Failed to fetch competitors');
      const data = await response.json();
      setCompetitors(data.competitors || []);
      setShowCompetitorsModal(true);
    } catch (error) {
      console.error("Error fetching competitors:", error);
      showNotification("Failed to load competitors. Please try again.", "error");
    }
  };

  // Fix: Add Competitor button handler
  const openAddCompetitorModal = () => {
    if (!selectedCompany) {
      showNotification("Select a company first", "error");
      return;
    }
    setShowAddCompetitorModal(true);
  };

  // Add missing addCompetitor implementation (was causing 'addCompetitor is not defined' error)
  const addCompetitor = async () => {
    if (!selectedCompany || !newCompetitor.name.trim()) {
      showNotification("Please enter a competitor name", "error");
      return;
    }

    // Validate company name length (database column limit)
    if (newCompetitor.name.trim().length > 100) {
      showNotification("Company name is too long. Please use a shorter name (max 100 characters)", "error");
      return;
    }

    // Validate that the name looks like a company name, not a description
    const nameText = newCompetitor.name.trim();
    if (nameText.includes('Website:') || nameText.includes('Facebook:') || nameText.includes('★ rating') || nameText.length > 200) {
      showNotification("Please enter only the company name, not a full description", "error");
      return;
    }

    // Validate URLs (simple)
    const urlPattern = /^(https?:\/\/)?[^\s/$.?#].[^\s]*$/;
    const urls = [
      { name: 'website', value: newCompetitor.website },
      { name: 'facebook', value: newCompetitor.facebookUrl },
      { name: 'instagram', value: newCompetitor.instagramUrl },
      { name: 'linkedin', value: newCompetitor.linkedinUrl },
      { name: 'google review', value: newCompetitor.googleReviewUrl }
    ];
    for (const u of urls) {
      if (u.value && !urlPattern.test(u.value)) {
        showNotification(`Please enter a valid URL for ${u.name}`, 'error');
        return;
      }
    }

    setIsAddingCompetitor(true);
    try {
      const payload = {
        companyId: selectedCompany,
        competitorName: newCompetitor.name.trim(),
        website: newCompetitor.website || '',
        industry: newCompetitor.industry || '',
        region: newCompetitor.region || '',
        facebookUrl: newCompetitor.facebookUrl || '',
        instagramUrl: newCompetitor.instagramUrl || '',
        linkedinUrl: newCompetitor.linkedinUrl || '',
        googleReviewUrl: newCompetitor.googleReviewUrl || ''
      };

      const resp = await fetch(`${API_BASE}/add-competitor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          userid: userID,
          firmid: firmID
        })
      });

      const result = await resp.json();

      if (resp.ok && result.success) {
        showNotification(result.message || 'Competitor added successfully', 'success');
        // reset form
        setNewCompetitor({
          name: "",
          website: "",
          industry: "",
          region: "",
          facebookUrl: "",
          linkedinUrl: "",
          instagramUrl: "",
          googleMapsUrl: "",
          googleReviewUrl: ""
        });
        setShowAddCompetitorModal(false);
        // refresh list
        try { await openCompetitorsModal(); } catch (e) { /* ignore */ }
      } else {
        showNotification(result.error || 'Failed to add competitor', 'error');
      }
    } catch (err) {
      console.error('❌ Error adding competitor:', err);
      showNotification('Error adding competitor', 'error');
    } finally {
      setIsAddingCompetitor(false);
    }
  };

  // When opening the Edit SWOT Preferences modal, always reload preferences from DB
  const openPreferencesModal = async () => {
    closeAllPopups();
    if (!selectedCompany) {
      showNotification("Select a company first", "error");
      return;
    }
    await loadPreferences(selectedCompany);
    setShowPreferencesModal(true);
  };

  // Create preference modal handler
  const openCreatePreferenceModal = async () => {
    closeAllPopups();
    if (!selectedCompany) {
      showNotification("Select a company first", "error");
      return;
    }
    try {
  const response = await fetch(`${API_BASE}/view-competitors/${selectedCompany}?userid=${encodeURIComponent(userID||'')}&firmid=${encodeURIComponent(firmID||'')}`);
      const data = await response.json();
      setAvailableCompetitors(data.competitors || []);
      setCreatePrefForm({
        name: "",
        timeRange: "weekly",
        competitorIds: [],
      });
      setShowCreatePreferenceModal(true);
    } catch (err) {
      console.error("❌ Error fetching competitors for preferences:", err);
      showNotification("Error loading competitors", "error");
    }
  };

  // Edit preference modal handler
  const openEditPreferenceModal = async (pref) => {
    closeAllPopups();
    if (!selectedCompany) {
      showNotification("Select a company first", "error");
      return;
    }
    try {
  const response = await fetch(`${API_BASE}/view-competitors/${selectedCompany}?userid=${encodeURIComponent(userID||'')}&firmid=${encodeURIComponent(firmID||'')}`);
      const data = await response.json();
      setAvailableCompetitors(data.competitors || []);
      setEditPrefForm({
        ...pref,
        competitorIds: pref.competitorIds || [],
      });
      setShowEditPreferenceModal(true);
    } catch (err) {
      console.error("❌ Error fetching competitors for edit:", err);
      showNotification("Error loading competitors", "error");
    }
  };

  // Handle competitor selection for create
  const handleCreatePrefCompetitorSelection = (competitorId, isChecked) => {
    if (isChecked) {
      setCreatePrefForm({
        ...createPrefForm,
        competitorIds: [...createPrefForm.competitorIds, competitorId]
      });
    } else {
      setCreatePrefForm({
        ...createPrefForm,
        competitorIds: createPrefForm.competitorIds.filter(id => id !== competitorId)
      });
    }
  };

  // Handle competitor selection for edit
  const handleEditPrefCompetitorSelection = (competitorId, isChecked) => {
    if (!editPrefForm) return;
    if (isChecked) {
      setEditPrefForm({
        ...editPrefForm,
        competitorIds: [...editPrefForm.competitorIds, competitorId]
      });
    } else {
      setEditPrefForm({
        ...editPrefForm,
        competitorIds: editPrefForm.competitorIds.filter(id => id !== competitorId)
      });
    }
  };

  // Save new preference
  const savePreference = async () => {
    if (!selectedCompany) return showNotification("Select a company first", "error");
    if (!userID || !firmID) return showNotification("Missing user/firm context. Open the app with ?userid=...&firmid=...", "error");
    if (!createPrefForm.name.trim()) return showNotification("Preference name is required", "error");
    setSavingPreference(true);
    try {
      const response = await fetch(`${API_BASE}/save-preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompany,
          name: createPrefForm.name,
          timeRange: createPrefForm.timeRange,
          competitorIds: createPrefForm.competitorIds,
          userid: userID,
          firmid: firmID
        }),
      });
      const data = await response.json();
      if (data.success) {
        setShowCreatePreferenceModal(false);
        loadPreferences(selectedCompany);
        showNotification("Preference saved successfully", "success");
      } else {
        showNotification("Error saving preference: " + data.error, "error");
      }
    } catch (err) {
      console.error("❌ Error saving preference:", err);
      showNotification("Error saving preference", "error");
    } finally {
      setSavingPreference(false);
    }
  };

  // Save edited preference
  const saveEditPreference = async () => {
    if (!selectedCompany || !editPrefForm) return;
    if (!userID || !firmID) return showNotification("Missing user/firm context. Open the app with ?userid=...&firmid=...", "error");
    if (!editPrefForm.name.trim()) return showNotification("Preference name is required", "error");
    setSavingEditPreference(true);
    try {
      const response = await fetch(`${API_BASE}/update-preference/${editPrefForm.prefId}?userid=${encodeURIComponent(userID||'')}&firmid=${encodeURIComponent(firmID||'')}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompany,
          name: editPrefForm.name,
          timeRange: editPrefForm.timeRange,
          competitorIds: editPrefForm.competitorIds,
          userid: userID,
          firmid: firmID
        }),
      });
      const data = await response.json();
      if (data.success) {
        setShowEditPreferenceModal(false);
        loadPreferences(selectedCompany);
        showNotification("Preference updated successfully", "success");
      } else {
        showNotification("Error updating preference: " + data.error, "error");
      }
    } catch (err) {
      console.error("❌ Error updating preference:", err);
      showNotification("Error updating preference", "error");
    } finally {
      setSavingEditPreference(false);
    }
  };

  // Delete preference
  const deletePreference = async (prefId) => {
    if (!window.confirm("Are you sure you want to delete this preference?")) return;
    if (!userID || !firmID) return showNotification("Missing user/firm context. Open the app with ?userid=...&firmid=...", "error");
    try {
      await fetch(`${API_BASE}/delete-preference/${prefId}?userid=${encodeURIComponent(userID||'')}&firmid=${encodeURIComponent(firmID||'')}`, { method: "DELETE" });
      await loadPreferences(selectedCompany);
      showNotification("Preference deleted successfully", "success");
    } catch (err) {
      console.error("❌ Error deleting preference:", err);
      showNotification("Error deleting preference", "error");
    }
  };

  // Report Generation Functions
  const generateReport = async (reportType) => {
    if (!selectedCompany) {
      alert("Please select a company first.");
      return;
    }
    
    if (!selectedPreferenceId) {
      alert("Please SELECT/CREATE a preference from settings first.");
      return;
    }

    const selectedPref = preferences.find(p => p.prefId === selectedPreferenceId);
    if (!selectedPref) {
      alert("Please select a valid preference.");
      return;
    }

    setGeneratingReport(true);
    // Hide the SWOT summary if generating any report other than SWOT
    if (reportType !== 'swot-analysis') {
      setSwot(null);
    }

    try {
      // Special handling for SWOT analysis since it has a different endpoint
      const endpoint = reportType === 'swot-analysis' 
        ? `${API_BASE}/generate-${reportType}`
        : `${API_BASE}/generate-report/${reportType}`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompany,
          competitorIds: selectedPref.competitorIds || [],
          userid: userID,
          firmid: firmID,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setReportResult(data.report);
        setShowReportModal(true);
      } else {
        alert("Error generating report: " + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error("❌ Error generating report:", err);
      alert("Error generating report: " + err.message);
    } finally {
      setGeneratingReport(false);
      setShowReportDropdown(false);
    }
  };

  const reportTypes = [
    { id: "swot-analysis", name: "SWOT Analysis", description: "Strengths, Weaknesses, Opportunities, Threats" },
    { id: "competitor-analysis", name: "Competitor Analysis", description: "Detailed competitor market analysis" },
    { id: "market-share", name: "Market Share Analysis", description: "Market share distribution and positioning" },
    { id: "content-gap", name: "Content Gap Analysis", description: "Content opportunities and strategy gaps" },
    { id: "technical-seo", name: "Technical SEO Analysis", description: "Website performance and SEO comparison" },
    { id: "ux-comparison", name: "UX Comparison", description: "User experience and design analysis" },
    { id: "pricing-comparison", name: "Pricing Comparison", description: "Pricing strategies and positioning" },
    { id: "brand-presence", name: "Brand Presence Analysis", description: "Brand visibility across channels" },
    { id: "audience-overlap", name: "Audience Overlap Analysis", description: "Audience segmentation insights" },
    { id: "30-60-90", name: "30-60-90 Plan", description: "90-day execution roadmap" },
    { id: "revenue-model-canvas", name: "Revenue Model Canvas", description: "Monetization & business model" },
    { id: "churn-fix", name: "Churn Fix", description: "Retention action plan and experiments" },
    { id: "kpi-dashboard-blueprint", name: "KPI Dashboard Blueprint", description: "Metrics tree and dashboard design" },
    { id: "go-to-market-plan", name: "Go-to-Market Plan", description: "ICP, messaging, channels, and timeline" },
    { id: "value-proposition", name: "Value Proposition", description: "Differentiation and messaging" },
    { id: "pivot-ideas", name: "Pivot Ideas", description: "Adjacency and pivot options" }
  ];

  // Helper to parse markdown tables to arrays for jsPDF autotable
  // eslint-disable-next-line no-unused-vars
  function extractTablesFromMarkdown(md) {
    const tableRegex = /((?:\|.+\|\n)+)/g;
    const tables = [];
    let match;
    while ((match = tableRegex.exec(md)) !== null) {
      const lines = match[1].trim().split('\n').filter(Boolean);
      if (lines.length < 2) continue;
      const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
      const rows = lines.slice(2).map(row => row.split('|').map(cell => cell.trim()).filter(Boolean));
      tables.push({ headers, rows });
    }
    return tables;
  }

  // Helper to remove tables from markdown
  // eslint-disable-next-line no-unused-vars
  function removeTablesFromMarkdown(md) {
    return md.replace(/((?:\|.+\|\n)+)/g, '');
  }

  // Helper to clean up asterisks and markdown markers from text
  // eslint-disable-next-line no-unused-vars
  function cleanReportText(text) {
    // Remove markdown, asterisks, and list markers
    let cleaned = text
      .replace(/^[*]+\s?/gm, '')
      .replace(/\*\*/g, '')
      .replace(/^\s*-\s?/gm, '')
      .replace(/^#+\s?/gm, '')
      .replace(/\*/g, '')
      .replace(/\+/g, '') // Remove plus signs
      .trim();

    cleaned = cleaned
      .split('\n')
      .filter(line => {
        const vowels = (line.match(/[aeiou]/gi) || []).length;
        return vowels >= 3 || line.length < 20;
      })
      .join('\n');

    return cleaned;
  }

  // Modal style for action plan and reports
// Modal overlay style for centered popups
const modalOverlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  padding: '20px',
  overflowY: 'auto'
};

const modalContentStyle = {
  position: 'relative',
  width: '100%',
  maxWidth: '900px',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: 32,
  maxHeight: '85vh',
  overflowY: 'auto',
  margin: 'auto'
};

// (Removed duplicate exportCurrentReportAsPDF function to fix redeclaration error)

// (Removed duplicate exportAllReportsAsPDF function to fix redeclaration error)

// Placeholder for summary export (to be implemented)
// (Function removed to fix redeclaration error)

// Add Action Plan state
  const [selectedActionCompetitor, setSelectedActionCompetitor] = useState("");
  const [actionPlan, setActionPlan] = useState(null);
  const [loadingActionPlan, setLoadingActionPlan] = useState(false);
  const [userInput, setUserInput] = useState(""); // Add user input state
  const [actionPlanStatus, setActionPlanStatus] = useState("pending"); // Add status state

  // Fetch available competitors for action plan dropdown (when company changes)
  useEffect(() => {
    const fetchAvailableCompetitors = async () => {
      if (!selectedCompany) {
        setAvailableCompetitors([]);
        return;
      }
      try {
  const resp = await fetch(`${API_BASE}/view-competitors/${selectedCompany}?userid=${encodeURIComponent(userID||'')}&firmid=${encodeURIComponent(firmID||'')}`);
        const data = await resp.json();
        setAvailableCompetitors(data.competitors || []);
      } catch {
        setAvailableCompetitors([]);
      }
    };
    fetchAvailableCompetitors();
  }, [selectedCompany, userID, firmID]);

  // Fetch saved action plan when competitor is selected
  useEffect(() => {
    const fetchSavedActionPlan = async () => {
      if (!selectedCompany || !selectedActionCompetitor) {
        setActionPlan(null);
        setActionPlanStatus("pending"); // Reset status
        return;
      }
      setLoadingActionPlan(true);
      try {
        // Get the latest saved action plan
        const resp = await fetch(`${API_BASE}/get-action-plan?companyId=${selectedCompany}&competitorId=${selectedActionCompetitor}&userid=${userID}&firmid=${firmID}`);
        const data = await resp.json();
        console.log("Fetched action plan:", data);
        if (data.success && data.actionPlan) {
          // Set the action plan content (display as report, not in textarea)
          setActionPlan({ content: data.actionPlan.STEP_ACTION });
          // Set the status from the saved data
          setActionPlanStatus(data.actionPlan.STATUS || "pending");
          // Do not set userInput to the saved action plan; only prefill if you want to show previous feedback/notes
          setUserInput("");
        } else {
          console.log("No action plan found.");
          setActionPlan(null);
          setActionPlanStatus("pending");
          setUserInput("");
        }
      } catch (err) {
        console.error("Error fetching action plan:", err);
        setActionPlan(null);
        setActionPlanStatus("pending");
        setUserInput("");
      } finally {
        setLoadingActionPlan(false);
      }
    };
    fetchSavedActionPlan();
  }, [selectedCompany, selectedActionCompetitor, userID, firmID]);

  // Generate / Refresh Action Plan
  const generateActionPlan = async () => {
    if (!selectedCompany) {
      showNotification("Select a company first", "error");
      return;
    }
    if (!selectedActionCompetitor) {
      showNotification("Select a competitor for the action plan", "error");
      return;
    }
    setLoadingActionPlan(true);
    setActionPlan(null);
    try {
      console.log("Generating action plan for", selectedCompany, selectedActionCompetitor);
      const resp = await fetch(`${API_BASE}/generate-action-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompany,
          competitorId: selectedActionCompetitor,
          userInput: userInput, // Include user input in the request
          status: actionPlanStatus, // Include status in the request
          userid: userID,
          firmid: firmID
        }),
      });
      const data = await resp.json();
      console.log("Action plan generation response:", data);
      if (data.success && data.report) {
        // Ensure consistent data structure for the modal
        console.log('Generated report content:', data.report);
        setActionPlan({ content: data.report });
        setShowActionPlanModal(true); // Open the modal to show the generated action plan

        // Save the new action plan to logs (replace old one)
        const logResp = await fetch(`${API_BASE}/log-action-step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: selectedCompany,
            competitorId: selectedActionCompetitor,
            stepId: "action-plan",
            stepAction: "Action Plan Generated",
            inputType: "json",
            status: "saved",
            userInput: JSON.stringify(data.report),
            actionType: "action-plan",
            userid: userID,
            firmid: firmID
          })
        });
        const logData = await logResp.json();
        console.log("Action plan log response:", logData);
      } else {
        showNotification(data.error || "Failed to generate action plan", "error");
      }
    } catch (err) {
      console.error("Error generating action plan:", err);
      showNotification("Error generating action plan", "error");
    } finally {
      setLoadingActionPlan(false);
    }
  };

  // Enhanced PDF export function with proper formatting and styling
  const exportCurrentReportAsPDF = async () => {
    const input = document.querySelector('.report-modal .report-content');
    if (!input || !reportResult) return;

    // Check for error message before exporting
    const errorStrings = [
      "Error generating",
      "error generating",
      "try again",
      "failed to generate"
    ];

    const textContent = input.textContent.toLowerCase();
    if (errorStrings.some(err => textContent.includes(err.toLowerCase()))) {
      const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'normal');
      pdf.text('There was an error generating this report.', 40, 60);
      pdf.text('Please try regenerating the report or contact support.', 40, 90);
      pdf.save(`${reportResult?.type?.replace(/-/g, '_') || 'error'}_report.pdf`);
      return;
    }

    try {
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'pt',
        format: 'a4',
        compress: true
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 40;
      const contentWidth = pageWidth - (2 * margin);
      
      // Add professional header
      pdf.setLineWidth(2);
      pdf.setDrawColor(52, 152, 219);
      pdf.setFillColor(52, 152, 219);
      pdf.rect(0, 0, pageWidth, 80, 'F');
      
      // Report title
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(20);
      const reportTitle = reportTypes.find(rt => rt.id === reportResult?.type)?.name || 'Report';
      pdf.text(reportTitle, pageWidth / 2, 35, { align: 'center' });
      
      // Company name
      if (selectedCompany) {
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'normal');
        const company = companies.find(c => c.id === selectedCompany);
        if (company) {
          pdf.text(`Company: ${company.name}`, pageWidth / 2, 55, { align: 'center' });
        }
      }

      // Reset text color for content
      pdf.setTextColor(0, 0, 0);
      let currentY = 120;

      // Get the raw content from reportResult
      let content = '';
      if (typeof reportResult === 'string') {
        content = reportResult;
      } else if (reportResult.content) {
        content = reportResult.content;
      } else if (reportResult.report) {
        content = reportResult.report;
      } else {
        content = JSON.stringify(reportResult, null, 2);
      }

      // Parse and render markdown content with proper formatting
      const htmlContent = marked.parse(content);
      
      // Convert HTML to structured content for PDF
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;
      
      // Process different HTML elements
      const elements = Array.from(tempDiv.children);
      
      for (const element of elements) {
        // Check if we need a new page
        if (currentY > pageHeight - 100) {
          pdf.addPage();
          currentY = margin;
        }

        const tagName = element.tagName.toLowerCase();
        const text = element.textContent.trim();
        
        if (!text) continue;

        switch (tagName) {
          case 'h1':
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(18);
            pdf.setTextColor(52, 152, 219);
            currentY += 20;
            const h1Lines = pdf.splitTextToSize(text, contentWidth);
            // eslint-disable-next-line no-loop-func
            h1Lines.forEach(line => {
              pdf.text(line, margin, currentY);
              currentY += 22;
            });
            currentY += 10;
            break;
            
          case 'h2':
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(16);
            pdf.setTextColor(39, 174, 96);
            currentY += 15;
            const h2Lines = pdf.splitTextToSize(text, contentWidth);
            // eslint-disable-next-line no-loop-func
            h2Lines.forEach(line => {
              pdf.text(line, margin, currentY);
              currentY += 20;
            });
            currentY += 8;
            break;
            
          case 'h3':
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(14);
            pdf.setTextColor(155, 89, 182);
            currentY += 12;
            const h3Lines = pdf.splitTextToSize(text, contentWidth);
            // eslint-disable-next-line no-loop-func
            h3Lines.forEach(line => {
              pdf.text(line, margin, currentY);
              currentY += 18;
            });
            currentY += 6;
            break;
            
          case 'p':
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(11);
            pdf.setTextColor(0, 0, 0);
            currentY += 5;
            const pLines = pdf.splitTextToSize(text, contentWidth);
            // eslint-disable-next-line no-loop-func
            pLines.forEach(line => {
              if (currentY > pageHeight - margin) {
                pdf.addPage();
                currentY = margin;
              }
              pdf.text(line, margin, currentY);
              currentY += 14;
            });
            currentY += 8;
            break;
            
          case 'ul':
          case 'ol':
            const listItems = Array.from(element.children);
            currentY += 5;
            // eslint-disable-next-line no-loop-func
            listItems.forEach((li, index) => {
              if (currentY > pageHeight - margin) {
                pdf.addPage();
                currentY = margin;
              }
              pdf.setFont('helvetica', 'normal');
              pdf.setFontSize(11);
              pdf.setTextColor(0, 0, 0);
              
              const bullet = tagName === 'ul' ? '•' : `${index + 1}.`;
              const liText = li.textContent.trim();
              const liLines = pdf.splitTextToSize(liText, contentWidth - 20);
              
              pdf.text(bullet, margin, currentY);
              // eslint-disable-next-line no-loop-func
              liLines.forEach((line, lineIndex) => {
                if (currentY > pageHeight - margin) {
                  pdf.addPage();
                  currentY = margin;
                }
                pdf.text(line, margin + 20, currentY);
                if (lineIndex < liLines.length - 1) currentY += 14;
              });
              currentY += 16;
            });
            currentY += 8;
            break;
            
          case 'table':
            // Handle tables with autoTable
            const rows = Array.from(element.querySelectorAll('tr'));
            if (rows.length > 0) {
              const headers = Array.from(rows[0].querySelectorAll('th, td')).map(cell => cell.textContent.trim());
              const data = rows.slice(1).map(row => 
                Array.from(row.querySelectorAll('td')).map(cell => cell.textContent.trim())
              );
              
              if (currentY > pageHeight - 200) {
                pdf.addPage();
                currentY = margin;
              }
              
              autoTable(pdf, {
                head: headers.length > 0 ? [headers] : undefined,
                body: data,
                startY: currentY,
                margin: { left: margin, right: margin },
                styles: {
                  fontSize: 10,
                  cellPadding: 4,
                },
                headStyles: {
                  fillColor: [52, 152, 219],
                  textColor: [255, 255, 255],
                  fontStyle: 'bold'
                },
                alternateRowStyles: {
                  fillColor: [245, 245, 245]
                }
              });
              
              currentY = pdf.lastAutoTable.finalY + 15;
            }
            break;
            
          default:
            // Handle any other content as regular text
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(11);
            pdf.setTextColor(0, 0, 0);
            const defaultLines = pdf.splitTextToSize(text, contentWidth);
            // eslint-disable-next-line no-loop-func
            defaultLines.forEach(line => {
              if (currentY > pageHeight - margin) {
                pdf.addPage();
                currentY = margin;
              }
              pdf.text(line, margin, currentY);
              currentY += 14;
            });
            currentY += 5;
        }
      }

      // Add footer
      const totalPages = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.setTextColor(128, 128, 128);
        pdf.text(
          `Generated on: ${new Date().toLocaleDateString()} | Page ${i} of ${totalPages}`,
          pageWidth / 2,
          pageHeight - 20,
          { align: 'center' }
        );
      }

      // Save the PDF
      pdf.save(`${reportResult?.type?.replace(/-/g, '_') || 'report'}_${new Date().toISOString().split('T')[0]}.pdf`);

    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Failed to generate PDF. Please try again.');
    }
  };

  // Enhanced export all reports function with proper markdown rendering
  // eslint-disable-next-line no-unused-vars
  const exportAllReportsAsPDF = async () => {
    if (!selectedCompany || !selectedPreferenceId) {
      alert("Please select a company and preference first.");
      return;
    }

    const selectedPref = preferences.find(p => p.prefId === selectedPreferenceId);
    if (!selectedPref) {
      alert("Please select a valid preference.");
      return;
    }

    const pdf = new jsPDF({
      orientation: 'p',
      unit: 'pt',
      format: 'a4',
      compress: true
    });
    
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 40;
    const contentWidth = pageWidth - (2 * margin);

    setShowExportProgress(true);
    setExportProgressMsg("Preparing comprehensive report export...");

    try {
      // Professional cover page
      pdf.setLineWidth(3);
      pdf.setDrawColor(52, 152, 219);
      pdf.setFillColor(52, 152, 219);
      pdf.rect(0, 0, pageWidth, 120, 'F');
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(28);
      pdf.text('Comprehensive Business Analysis', pageWidth / 2, 50, { align: 'center' });
      
      const company = companies.find(c => c.id === selectedCompany);
      if (company) {
        pdf.setFontSize(20);
        pdf.text(company.name, pageWidth / 2, 85, { align: 'center' });
      }

      // Add cover page details
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(14);
      pdf.text(`Generated on: ${new Date().toLocaleDateString()}`, pageWidth / 2, pageHeight / 2, { align: 'center' });
      
      if (selectedPref.competitorIds.length > 0) {
        pdf.setFontSize(12);
        pdf.text(`Analyzing ${selectedPref.competitorIds.length} competitors`, pageWidth / 2, pageHeight / 2 + 30, { align: 'center' });
      }

      // Table of Contents
      pdf.addPage();
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(20);
      pdf.setTextColor(52, 152, 219);
      pdf.text('Table of Contents', margin, 60);
      
      let tocY = 100;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(12);
      pdf.setTextColor(0, 0, 0);
      
      reportTypes.forEach((report, index) => {
        pdf.text(`${index + 1}. ${report.name}`, margin + 20, tocY);
        pdf.setFontSize(10);
        pdf.setTextColor(100, 100, 100);
        pdf.text(report.description, margin + 40, tocY + 15);
        pdf.setFontSize(12);
        pdf.setTextColor(0, 0, 0);
        tocY += 35;
        
        if (tocY > pageHeight - 100) {
          pdf.addPage();
          tocY = margin;
        }
      });

      // Process each report with enhanced formatting
      for (let i = 0; i < reportTypes.length; i++) {
        const report = reportTypes[i];
        setExportProgressMsg(`Processing: ${report.name} (${i + 1}/${reportTypes.length})`);

        let content = '';
        if (report.id === 'swot-analysis') {
          if (swot) {
            try {
              const obj = typeof swot === 'string' ? JSON.parse(swot) : swot;
              content = `# SWOT Analysis\n\n## Strengths\n${(obj.Strengths || []).map(s => `- ${s}`).join('\n')}\n\n## Weaknesses\n${(obj.Weaknesses || []).map(w => `- ${w}`).join('\n')}\n\n## Opportunities\n${(obj.Opportunities || []).map(o => `- ${o}`).join('\n')}\n\n## Threats\n${(obj.Threats || []).map(t => `- ${t}`).join('\n')}`;
            } catch {
              content = typeof swot === 'string' ? swot : JSON.stringify(swot, null, 2);
            }
          }
        } else {
          try {
            const response = await fetch(`${API_BASE}/generate-report/${report.id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                companyId: selectedCompany,
                competitorIds: selectedPref.competitorIds || [],
                userid: userID,
                firmid: firmID,
              }),
            });
            const data = await response.json();
            content = data?.report || '';
          } catch (error) {
            content = `Error generating ${report.name}: ${error.message}`;
          }
        }

        // Start new page for each report
        pdf.addPage();
        let currentY = margin;

        // Report header
        pdf.setLineWidth(2);
        pdf.setDrawColor(52, 152, 219);
        pdf.setFillColor(52, 152, 219);
        pdf.rect(0, 0, pageWidth, 60, 'F');
        
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(18);
        pdf.text(report.name, margin, 35);
        
        pdf.setTextColor(0, 0, 0);
        currentY = 90;

        // Parse and render markdown content
        if (content) {
          const htmlContent = marked.parse(content);
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = htmlContent;
          
          const elements = Array.from(tempDiv.children);
          
          for (const element of elements) {
            const tagName = element.tagName.toLowerCase();
            const text = element.textContent.trim();
            
            if (!text) continue;

            // Check if we need a new page
            if (currentY > pageHeight - 100) {
              pdf.addPage();
              currentY = margin;
            }

            switch (tagName) {
              case 'h1':
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(16);
                pdf.setTextColor(52, 152, 219);
                currentY += 15;
                const h1Lines = pdf.splitTextToSize(text, contentWidth);
                // eslint-disable-next-line no-loop-func
                h1Lines.forEach(line => {
                  pdf.text(line, margin, currentY);
                  currentY += 20;
                });
                currentY += 12;
                break;
                
              case 'h2':
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(14);
                pdf.setTextColor(39, 174, 96);
                currentY += 12;
                const h2Lines = pdf.splitTextToSize(text, contentWidth);
                // eslint-disable-next-line no-loop-func
                h2Lines.forEach(line => {
                  pdf.text(line, margin, currentY);
                  currentY += 18;
                });
                currentY += 10;
                break;
                
              case 'h3':
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(12);
                pdf.setTextColor(155, 89, 182);
                currentY += 10;
                const h3Lines = pdf.splitTextToSize(text, contentWidth);
                // eslint-disable-next-line no-loop-func
                h3Lines.forEach(line => {
                  pdf.text(line, margin, currentY);
                  currentY += 16;
                });
                currentY += 8;
                break;
                
              case 'p':
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(10);
                pdf.setTextColor(0, 0, 0);
                currentY += 3;
                const pLines = pdf.splitTextToSize(text, contentWidth);
                // eslint-disable-next-line no-loop-func
                pLines.forEach(line => {
                  if (currentY > pageHeight - margin) {
                    pdf.addPage();
                    currentY = margin;
                  }
                  pdf.text(line, margin, currentY);
                  currentY += 13;
                });
                currentY += 6;
                break;
                
              case 'ul':
              case 'ol':
                const listItems = Array.from(element.children);
                currentY += 3;
                // eslint-disable-next-line no-loop-func
                listItems.forEach((li, index) => {
                  if (currentY > pageHeight - margin) {
                    pdf.addPage();
                    currentY = margin;
                  }
                  pdf.setFont('helvetica', 'normal');
                  pdf.setFontSize(10);
                  pdf.setTextColor(0, 0, 0);
                  
                  const bullet = tagName === 'ul' ? '•' : `${index + 1}.`;
                  const liText = li.textContent.trim();
                  const liLines = pdf.splitTextToSize(liText, contentWidth - 20);
                  
                  pdf.text(bullet, margin, currentY);
                  // eslint-disable-next-line no-loop-func
                  liLines.forEach((line, lineIndex) => {
                    if (currentY > pageHeight - margin) {
                      pdf.addPage();
                      currentY = margin;
                    }
                    pdf.text(line, margin + 20, currentY);
                    if (lineIndex < liLines.length - 1) currentY += 13;
                  });
                  currentY += 15;
                });
                currentY += 6;
                break;
                
              case 'table':
                const rows = Array.from(element.querySelectorAll('tr'));
                if (rows.length > 0) {
                  const headers = Array.from(rows[0].querySelectorAll('th, td')).map(cell => cell.textContent.trim());
                  const data = rows.slice(1).map(row => 
                    Array.from(row.querySelectorAll('td')).map(cell => cell.textContent.trim())
                  );
                  
                  if (currentY > pageHeight - 200) {
                    pdf.addPage();
                    currentY = margin;
                  }
                  
                  autoTable(pdf, {
                    head: headers.length > 0 ? [headers] : undefined,
                    body: data,
                    startY: currentY,
                    margin: { left: margin, right: margin },
                    styles: {
                      fontSize: 9,
                      cellPadding: 3,
                    },
                    headStyles: {
                      fillColor: [52, 152, 219],
                      textColor: [255, 255, 255],
                      fontStyle: 'bold'
                    },
                    alternateRowStyles: {
                      fillColor: [245, 245, 245]
                    }
                  });
                  
                  currentY = pdf.lastAutoTable.finalY + 10;
                }
                break;
                
              default:
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(10);
                pdf.setTextColor(0, 0, 0);
                const defaultLines = pdf.splitTextToSize(text, contentWidth);
                // eslint-disable-next-line no-loop-func
                defaultLines.forEach(line => {
                  if (currentY > pageHeight - margin) {
                    pdf.addPage();
                    currentY = margin;
                  }
                  pdf.text(line, margin, currentY);
                  currentY += 13;
                });
                currentY += 3;
            }
          }
        }
      }

      // Add elegant closing page
      pdf.addPage();
      pdf.setLineWidth(3);
      pdf.setDrawColor(52, 152, 219);
      pdf.setFillColor(240, 248, 255);
      pdf.rect(30, 30, pageWidth - 60, pageHeight - 60, 'FD');
      
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(24);
      pdf.setTextColor(52, 152, 219);
      pdf.text('Thank You', pageWidth / 2, pageHeight / 2 - 20, { align: 'center' });
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(16);
      pdf.setTextColor(100, 100, 100);
      pdf.text('For using COMPA AI Strategic Analysis', pageWidth / 2, pageHeight / 2 + 20, { align: 'center' });

      // Add page numbers and footer to all pages
      const totalPages = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(128, 128, 128);
        
        if (i > 1 && i < totalPages) { // Skip footer on cover and closing pages
          pdf.text(
            `Executive Summary | COMPA AI | ${new Date().toLocaleDateString()}`,
            margin,
            pageHeight - 15
          );
          pdf.text(
            `Page ${i} of ${totalPages}`,
            pageWidth - margin,
            pageHeight - 15,
            { align: 'right' }
          );
        }
      }

      setExportProgressMsg('Finalizing PDF...');
      pdf.save(`Comprehensive_Business_Analysis_${company?.name || 'Report'}_${new Date().toISOString().split('T')[0]}.pdf`);
      
    } catch (error) {
      console.error('Error generating comprehensive PDF:', error);
      alert('Failed to generate comprehensive PDF. Please try again.');
    } finally {
      setShowExportProgress(false);
    }
  };

  // Enhanced summary export function with consistent formatting
  // eslint-disable-next-line no-unused-vars
  const exportSummaryReportAsPDF = async () => {
    if (!selectedCompany || !selectedPreferenceId) {
      alert('Please select a company and preference first.');
      return;
    }

    const selectedPref = preferences.find(p => p.prefId === selectedPreferenceId);
    if (!selectedPref) {
      alert('Please select a valid preference.');
      return;
    }

    const summaryPdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const pageWidth = summaryPdf.internal.pageSize.getWidth();
    const pageHeight = summaryPdf.internal.pageSize.getHeight();
    const margin = 40;
    const contentWidth = pageWidth - (2 * margin);

    setShowExportProgress(true);
    
    try {
      setExportProgressMsg('Gathering all reports...');
      
      // Gather all report contents
      const allReports = [];
      for (let i = 0; i < reportTypes.length; i++) {
        const report = reportTypes[i];
        let content = '';
        
        if (report.id === 'swot-analysis') {
          if (swot) {
            try {
              const obj = typeof swot === 'string' ? JSON.parse(swot) : swot;
              content = `# SWOT Analysis\n\n## Strengths\n${(obj.Strengths || []).map(s => `- ${s}`).join('\n')}\n\n## Weaknesses\n${(obj.Weaknesses || []).map(w => `- ${w}`).join('\n')}\n\n## Opportunities\n${(obj.Opportunities || []).map(o => `- ${o}`).join('\n')}\n\n## Threats\n${(obj.Threats || []).map(t => `- ${t}`).join('\n')}`;
            } catch {
              content = typeof swot === 'string' ? swot : JSON.stringify(swot, null, 2);
            }
          } else {
            // Fetch SWOT if not present
            const params = new URLSearchParams();
            params.append('companyId', selectedCompany);
            params.append('timeRange', selectedPref.timeRange);
            if (selectedPref.competitorIds.length > 0)
              params.append('competitorIds', selectedPref.competitorIds.join(','));
            if(userID) params.set('userid', userID);
            if(firmID) params.set('firmid', firmID);
            const response = await fetch(`${API_BASE}/generate-report/swot-analysis`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                companyId: selectedCompany,
                competitorIds: selectedPref.competitorIds || [],
                userid: userID,
                firmid: firmID,
                timeRange: selectedPref.timeRange
              })
            });
            const data = await response.json();
            try {
              const raw = data?.report?.content || data?.report;
              const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
              content = `# SWOT Analysis\n\n## Strengths\n${(obj.Strengths || []).map(s => `- ${s}`).join('\n')}\n\n## Weaknesses\n${(obj.Weaknesses || []).map(w => `- ${w}`).join('\n')}\n\n## Opportunities\n${(obj.Opportunities || []).map(o => `- ${o}`).join('\n')}\n\n## Threats\n${(obj.Threats || []).map(t => `- ${t}`).join('\n')}`;
            } catch {
              content = data?.report?.content || data?.report || 'No SWOT data';
            }
          }
        } else {
          // Fetch other reports
          try {
            const response = await fetch(`${API_BASE}/generate-report/${report.id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                companyId: selectedCompany,
                competitorIds: selectedPref.competitorIds || [],
                userid: userID,
                firmid: firmID,
              }),
            });
            const data = await response.json();
            content = data?.report || '';
          } catch (error) {
            content = `Error fetching ${report.name}: ${error.message}`;
          }
        }

        allReports.push(content);
      }
      
      // Call backend to generate summary
      setExportProgressMsg('Generating AI summary...');
      const summaryRes = await fetch(`${API_BASE}/generate-summary-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompany,
          reports: allReports,
          userid: userID,
          firmid: firmID,
        })
      });

      const summaryData = await summaryRes.json();
      if (!summaryData.success) {
        setShowExportProgress(false);
        alert('Failed to generate summary.');
        return;
      }

      setExportProgressMsg('Creating summary PDF...');
      
      // Premium cover page
      summaryPdf.setLineWidth(3);
      summaryPdf.setDrawColor(52, 152, 219);
      summaryPdf.setFillColor(52, 152, 219);
      summaryPdf.rect(0, 0, pageWidth, 120, 'F');
      
      summaryPdf.setTextColor(255, 255, 255);
      summaryPdf.setFont('helvetica', 'bold');
      summaryPdf.setFontSize(28);
      summaryPdf.text('Executive Summary', pageWidth / 2, 50, { align: 'center' });
      
      const company = companies.find(c => c.id === selectedCompany);
      if (company) {
        summaryPdf.setFontSize(18);
        summaryPdf.text(`${company.name} - Strategic Analysis`, pageWidth / 2, 85, { align: 'center' });
      }

      // Add executive summary details
      summaryPdf.setTextColor(0, 0, 0);
      summaryPdf.setFont('helvetica', 'normal');
      summaryPdf.setFontSize(12);
      summaryPdf.text(`Generated: ${new Date().toLocaleDateString()}`, margin, 180);
      summaryPdf.text(`Analysis Period: ${selectedPref.timeRange}`, margin, 200);
      summaryPdf.text(`Competitors Analyzed: ${selectedPref.competitorIds.length}`, margin, 220);
      summaryPdf.text(`Total Reports: ${reportTypes.length}`, margin, 240);

      // Add content page
      summaryPdf.addPage();
      let currentY = margin;

      // Parse and render summary content with enhanced formatting
      const summaryContent = summaryData.summary?.content || '';
      if (summaryContent) {
        const htmlContent = marked.parse(summaryContent);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        
        const elements = Array.from(tempDiv.children);
        
        for (const element of elements) {
          const tagName = element.tagName.toLowerCase();
          const text = element.textContent.trim();
          
          if (!text) continue;

          // Check if we need a new page
          if (currentY > pageHeight - 100) {
            summaryPdf.addPage();
            currentY = margin;
          }

          switch (tagName) {
            case 'h1':
              summaryPdf.setFont('helvetica', 'bold');
              summaryPdf.setFontSize(18);
              summaryPdf.setTextColor(52, 152, 219);
              currentY += 20;
              const h1Lines = summaryPdf.splitTextToSize(text, contentWidth);
              // eslint-disable-next-line no-loop-func
              h1Lines.forEach(line => {
                summaryPdf.text(line, margin, currentY);
                currentY += 22;
              });
              currentY += 12;
              break;
              
            case 'h2':
              summaryPdf.setFont('helvetica', 'bold');
              summaryPdf.setFontSize(16);
              summaryPdf.setTextColor(39, 174, 96);
              currentY += 15;
              const h2Lines = summaryPdf.splitTextToSize(text, contentWidth);
              // eslint-disable-next-line no-loop-func
              h2Lines.forEach(line => {
                summaryPdf.text(line, margin, currentY);
                currentY += 20;
              });
              currentY += 10;
              break;
              
            case 'h3':
              summaryPdf.setFont('helvetica', 'bold');
              summaryPdf.setFontSize(14);
              summaryPdf.setTextColor(155, 89, 182);
              currentY += 12;
              const h3Lines = summaryPdf.splitTextToSize(text, contentWidth);
              // eslint-disable-next-line no-loop-func
              h3Lines.forEach(line => {
                summaryPdf.text(line, margin, currentY);
                currentY += 18;
              });
              currentY += 8;
              break;
              
            case 'p':
              summaryPdf.setFont('helvetica', 'normal');
              summaryPdf.setFontSize(11);
              summaryPdf.setTextColor(0, 0, 0);
              currentY += 5;
              const pLines = summaryPdf.splitTextToSize(text, contentWidth);
              // eslint-disable-next-line no-loop-func
              pLines.forEach(line => {
                if (currentY > pageHeight - margin) {
                  summaryPdf.addPage();
                  currentY = margin;
                }
                summaryPdf.text(line, margin, currentY);
                currentY += 15;
              });
              currentY += 8;
              break;
              
            case 'ul':
            case 'ol':
              const listItems = Array.from(element.children);
              currentY += 5;
              // eslint-disable-next-line no-loop-func
              listItems.forEach((li, index) => {
                if (currentY > pageHeight - margin) {
                  summaryPdf.addPage();
                  currentY = margin;
                }
                summaryPdf.setFont('helvetica', 'normal');
                summaryPdf.setFontSize(11);
                summaryPdf.setTextColor(0, 0, 0);
                
                const bullet = tagName === 'ul' ? '•' : `${index + 1}.`;
                const liText = li.textContent.trim();
                const liLines = summaryPdf.splitTextToSize(liText, contentWidth - 20);
                
                summaryPdf.text(bullet, margin, currentY);
                // eslint-disable-next-line no-loop-func
                liLines.forEach((line, lineIndex) => {
                  if (currentY > pageHeight - margin) {
                    summaryPdf.addPage();
                    currentY = margin;
                  }
                  summaryPdf.text(line, margin + 20, currentY);
                  if (lineIndex < liLines.length - 1) currentY += 15;
                });
                currentY += 17;
              });
              currentY += 8;
              break;
              
            case 'table':
              const rows = Array.from(element.querySelectorAll('tr'));
              if (rows.length > 0) {
                const headers = Array.from(rows[0].querySelectorAll('th, td')).map(cell => cell.textContent.trim());
                const data = rows.slice(1).map(row => 
                  Array.from(row.querySelectorAll('td')).map(cell => cell.textContent.trim())
                );
                
                if (currentY > pageHeight - 200) {
                  summaryPdf.addPage();
                  currentY = margin;
                }
                
                autoTable(summaryPdf, {
                  head: headers.length > 0 ? [headers] : undefined,
                  body: data,
                  startY: currentY,
                  margin: { left: margin, right: margin },
                  styles: {
                    fontSize: 10,
                    cellPadding: 4,
                  },
                  headStyles: {
                    fillColor: [52, 152, 219],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold'
                  },
                  alternateRowStyles: {
                    fillColor: [245, 245, 245]
                  }
                });
                
                currentY = summaryPdf.lastAutoTable.finalY + 15;
              }
              break;
              
            default:
              summaryPdf.setFont('helvetica', 'normal');
              summaryPdf.setFontSize(11);
              summaryPdf.setTextColor(0, 0, 0);
              const defaultLines = summaryPdf.splitTextToSize(text, contentWidth);
              // eslint-disable-next-line no-loop-func
              defaultLines.forEach(line => {
                if (currentY > pageHeight - margin) {
                  summaryPdf.addPage();
                  currentY = margin;
                }
                summaryPdf.text(line, margin, currentY);
                currentY += 15;
              });
              currentY += 5;
          }
        }
      }

      // Add elegant closing page
      summaryPdf.addPage();
      summaryPdf.setLineWidth(3);
      summaryPdf.setDrawColor(52, 152, 219);
      summaryPdf.setFillColor(240, 248, 255);
      summaryPdf.rect(30, 30, pageWidth - 60, pageHeight - 60, 'FD');
      
      summaryPdf.setFont('helvetica', 'bold');
      summaryPdf.setFontSize(24);
      summaryPdf.setTextColor(52, 152, 219);
      summaryPdf.text('Thank You', pageWidth / 2, pageHeight / 2 - 20, { align: 'center' });
      
      summaryPdf.setFont('helvetica', 'normal');
      summaryPdf.setFontSize(16);
      summaryPdf.setTextColor(100, 100, 100);
      summaryPdf.text('For using COMPA AI Strategic Analysis', pageWidth / 2, pageHeight / 2 + 20, { align: 'center' });

      // Add page numbers and footer to all pages
      const totalPages = summaryPdf.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        summaryPdf.setPage(i);
        summaryPdf.setFontSize(8);
        summaryPdf.setTextColor(128, 128, 128);
        
        if (i > 1 && i < totalPages) { // Skip footer on cover and closing pages
          summaryPdf.text(
            `Executive Summary | COMPA AI | ${new Date().toLocaleDateString()}`,
            margin,
            pageHeight - 15
          );
          summaryPdf.text(
            `Page ${i} of ${totalPages}`,
            pageWidth - margin,
            pageHeight - 15,
            { align: 'right' }
          );
        }
      }

      setExportProgressMsg('Finalizing summary PDF...');
      summaryPdf.save(`Executive_Summary_${company?.name || 'Report'}_${new Date().toISOString().split('T')[0]}.pdf`);
      
    } catch (error) {
      console.error('Error generating summary PDF:', error);
      alert('Failed to generate summary PDF. Please try again.');
    } finally {
      setShowExportProgress(false);
    }
  };

  // Expose global bridge so other UI (e.g. top-right gear) can open the API Manager
  useEffect(() => {
    const openHandler = () => setShowApiManager(true);
    // Listen for a simple window event named 'openApiManager'
    window.addEventListener('openApiManager', openHandler);

    // Convenience helper for dev / manual trigger
    // call `window.openApiManager()` from console to open modal
    window.openApiManager = () => {
      window.dispatchEvent(new Event('openApiManager'));
    };

    return () => {
      window.removeEventListener('openApiManager', openHandler);
      try { delete window.openApiManager; } catch (e) { /* ignore in some browsers */ }
    };
  }, []);

  // Close all popups when clicking outside any modal or dropdown
  useEffect(() => {
    const handleClick = (e) => {
      // Only close if the click is outside any modal or dropdown, but DO NOT close the report modal
      const reportModal = document.querySelector('.modal.report-modal');
      if (reportModal && reportModal.contains(e.target)) {
        return;
      }
      // Preferences modal
      if (showPreferencesModal && preferencesModalRef.current && preferencesModalRef.current.contains(e.target)) {
        return;
      }
      // Create Preference modal
      if (showCreatePreferenceModal && createPreferenceModalRef.current && createPreferenceModalRef.current.contains(e.target)) {
        return;
      }
      // Edit Preference modal
      if (showEditPreferenceModal && editPreferenceModalRef.current && editPreferenceModalRef.current.contains(e.target)) {
        return;
      }
      // Add Competitor modal
      if (showAddCompetitorModal && addCompetitorModalRef.current && addCompetitorModalRef.current.contains(e.target)) {
        return;
      }
      // Action Plan modal
      if (showActionPlanModal && document.querySelector('.modal.report-modal') && document.querySelector('.modal.report-modal').contains(e.target)) {
        return;
      }
      // For other modals/dropdowns (excluding action plan modal)
      const modalOrDropdown = document.querySelector('.modal:not(.report-modal), .report-dropdown, .report-dropdown-container');
      if (modalOrDropdown && !modalOrDropdown.contains(e.target)) {
        setShowReportDropdown(false);
        setShowAddCompetitorModal(false);
        setShowCompetitorsModal(false);
        setShowCreatePreferenceModal(false);
        setShowEditPreferenceModal(false);
        setShowMissingInfoModal(false);
        // Removed setShowActionPlanModal(false) - action plan modal only closes via close button
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPreferencesModal, showCreatePreferenceModal, showEditPreferenceModal, showAddCompetitorModal, showActionPlanModal]);

  // Main component render
  // Dashboard style container
  const dashboardStyle = {
    background: 'var(--color-bg)',
    minHeight: '100vh',
    padding: '32px 0',
    fontFamily: 'var(--font-family)',
  };
  const cardStyle = {
    background: 'var(--color-bg-card)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow)',
    padding: '32px',
    margin: '0 auto 32px auto',
    maxWidth: '900px',
    border: '1px solid var(--color-border)',
  };
  const headingStyle = {
    color: 'var(--color-primary-light)',
    fontWeight: 'var(--font-weight-bold)',
    fontSize: '2rem',
    marginBottom: '16px',
    letterSpacing: '1px',
  };
  const subheadingStyle = {
    color: 'var(--color-accent)',
    fontWeight: 'var(--font-weight-semibold)',
    fontSize: '1.2rem',
    marginBottom: '12px',
  };
  return (
    <div>
      {/* Fixed Full-Width Banner */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: 'linear-gradient(135deg, #1a365d 0%, #2563eb 100%)',
        padding: '24px 48px',
        zIndex: 1000,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        {/* Decorative background pattern */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255, 255, 255, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(255, 255, 255, 0.1) 0%, transparent 50%)',
          pointerEvents: 'none'
        }}></div>
        
        <div style={{ 
          position: 'relative', 
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24
        }}>
          {/* Left: Title */}
          <div>
            <h1 style={{ 
              color: '#ffffff',
              fontSize: '1.75rem',
              fontWeight: 800,
              margin: 0,
              letterSpacing: '-0.02em',
              textShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
            }}>
              Competitive Intelligence Dashboard
            </h1>
            <p style={{ 
              color: 'rgba(255, 255, 255, 0.85)',
              fontSize: '0.9rem',
              fontWeight: 400,
              margin: '4px 0 0 0'
            }}>
              Empower Your Future with AI-Driven Insights
            </p>
          </div>
          
          {/* Right: User Info & Actions */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16
          }}>
            {/* User Info Badge */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 8,
              padding: '8px 16px',
              gap: 12
            }}>
              <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.9)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16 }}>👤</span>
                <code style={{ 
                  color: '#ffffff', 
                  backgroundColor: 'rgba(255, 255, 255, 0.2)', 
                  padding: '3px 8px', 
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 12
                }}>{userID}</code>
              </div>
              <div style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.3)' }}></div>
              <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.9)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16 }}>🏢</span>
                <code style={{ 
                  color: '#ffffff', 
                  backgroundColor: 'rgba(255, 255, 255, 0.2)', 
                  padding: '3px 8px', 
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 12
                }}>{firmID}</code>
              </div>
            </div>
            
            {/* Configure AI Button */}
            <button
              onClick={() => setShowApiManager(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(255, 255, 255, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                color: '#ffffff',
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span>⚙️</span>
              Configure AI
            </button>
          </div>
        </div>
      </div>
      
      {/* Main Content Area with Top Padding */}
      <div style={{
        paddingTop: '120px',
        background: 'var(--color-bg)',
        minHeight: '100vh'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '32px'
        }}>
    
    {/* Dashboard Layout with Left Sidebar */}
    <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
      {/* Left Sidebar - Action Menu */}
      <aside style={{
        width: '280px',
        flexShrink: 0,
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        boxShadow: '0 4px 16px rgba(22, 119, 255, 0.08)',
        position: 'sticky',
        top: '24px',
        maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <h3 style={{ 
            margin: '0', 
            padding: '24px 16px 12px',
            color: 'var(--color-primary)', 
            fontWeight: 700, 
            fontSize: '1.25rem',
            borderBottom: '2px solid var(--color-border)',
            flexShrink: 0
          }}>Actions</h3>
          
          {/* Action Menu List - Scrollable */}
          <nav style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '8px',
            padding: '16px',
            overflowY: 'auto',
            overflowX: 'hidden',
            flex: 1
          }}>
            {/* Generate Reports Section - Collapsible */}
            <div style={{ marginBottom: '12px' }}>
              <button
                onClick={() => setReportsExpanded(!reportsExpanded)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: 'var(--color-text-muted)', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px'
                }}>Reports</div>
                <span style={{ 
                  fontSize: '14px',
                  color: 'var(--color-text-muted)',
                  transform: reportsExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease'
                }}>▶</span>
              </button>
              
              {/* Collapsible Reports List */}
              <div style={{
                maxHeight: reportsExpanded ? '1000px' : '0',
                overflow: 'hidden',
                transition: 'max-height 0.3s ease-in-out'
              }}>
              {reportTypes.map((report) => (
                <button
                  key={report.id}
                  onClick={() => generateReport(report.id)}
                  disabled={!selectedCompany || generatingReport}
                  className="sidebar-nav-link"
                  style={{ 
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px',
                    background: generatingReport ? 'rgba(22, 119, 255, 0.1)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: generatingReport ? 'wait' : 'pointer',
                    transition: 'all 0.2s ease',
                    color: generatingReport ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontSize: '14px',
                    fontWeight: 500,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    opacity: (!selectedCompany || generatingReport) ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.background = 'var(--color-bg-hover)';
                      e.currentTarget.style.color = 'var(--color-primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = generatingReport ? 'rgba(22, 119, 255, 0.1)' : 'transparent';
                    e.currentTarget.style.color = generatingReport ? 'var(--color-primary)' : 'var(--color-text-secondary)';
                  }}
                >
                  <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {generatingReport && (
                      <span style={{ 
                        display: 'inline-block',
                        width: '12px',
                        height: '12px',
                        border: '2px solid var(--color-primary)',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite'
                      }}></span>
                    )}
                    {report.name}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                    {generatingReport ? 'Generating report...' : report.description}
                  </span>
                </button>
              ))}
              </div>
            </div>

            {/* Competitor Management Section - Collapsible */}
            <div style={{ marginBottom: '12px' }}>
              <button
                onClick={() => setCompetitorsExpanded(!competitorsExpanded)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: 'var(--color-text-muted)', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px'
                }}>Competitors</div>
                <span style={{ 
                  fontSize: '14px',
                  color: 'var(--color-text-muted)',
                  transform: competitorsExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease'
                }}>▶</span>
              </button>
              
              {/* Collapsible Competitors List */}
              <div style={{
                maxHeight: competitorsExpanded ? '500px' : '0',
                overflow: 'hidden',
                transition: 'max-height 0.3s ease-in-out'
              }}>
              
              <button 
                onClick={openCompetitorsModal} 
                disabled={!selectedCompany}
                className="sidebar-nav-link"
                style={{ 
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'var(--color-text-secondary)',
                  fontSize: '14px',
                  fontWeight: 500
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.background = 'var(--color-bg-hover)';
                    e.currentTarget.style.color = 'var(--color-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
              >
                <span style={{ marginRight: '8px' }}>👁️</span>
                View Competitors
              </button>
              
              <button 
                onClick={openAddCompetitorModal}
                disabled={!selectedCompany || isAddingCompetitor}
                className="sidebar-nav-link"
                style={{ 
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'var(--color-text-secondary)',
                  fontSize: '14px',
                  fontWeight: 500
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.background = 'var(--color-bg-hover)';
                    e.currentTarget.style.color = 'var(--color-success)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
              >
                <span style={{ marginRight: '8px' }}>➕</span>
                {isAddingCompetitor ? 'Adding...' : 'Add Competitor'}
              </button>
              </div>
            </div>

            {/* Settings Section - Collapsible */}
            <div style={{ marginBottom: '12px' }}>
              <button
                onClick={() => setSettingsExpanded(!settingsExpanded)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: 'var(--color-text-muted)', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px'
                }}>Settings</div>
                <span style={{ 
                  fontSize: '14px',
                  color: 'var(--color-text-muted)',
                  transform: settingsExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease'
                }}>▶</span>
              </button>
              
              {/* Collapsible Settings List */}
              <div style={{
                maxHeight: settingsExpanded ? '500px' : '0',
                overflow: 'hidden',
                transition: 'max-height 0.3s ease-in-out'
              }}>
              
              <button 
                onClick={openPreferencesModal} 
                disabled={!selectedCompany}
                className="sidebar-nav-link"
                style={{ 
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'var(--color-text-secondary)',
                  fontSize: '14px',
                  fontWeight: 500
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.background = 'var(--color-bg-hover)';
                    e.currentTarget.style.color = 'var(--color-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
              >
                <span style={{ marginRight: '8px' }}>⚙️</span>
                Edit SWOT Preferences
              </button>
              
              <button 
                onClick={openSavedReportsModal} 
                disabled={!selectedCompany}
                className="sidebar-nav-link"
                style={{ 
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'var(--color-text-secondary)',
                  fontSize: '14px',
                  fontWeight: 500
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.background = 'var(--color-bg-hover)';
                    e.currentTarget.style.color = 'var(--color-accent)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
              >
                <span style={{ marginRight: '8px' }}>📁</span>
                View Saved Reports
              </button>
              </div>
            </div>
          </nav>
        </aside>

        {/* Main Content Area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Company Selection - Premium */}
          <div style={{
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            border: '1px solid var(--color-border)',
            borderRadius: 16,
            padding: 32,
            marginBottom: 32,
            boxShadow: '0 8px 32px rgba(22, 119, 255, 0.12)',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Decorative top border */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-light) 100%)'
            }}></div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-light) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                boxShadow: '0 4px 12px rgba(22, 119, 255, 0.25)'
              }}>🏢</div>
              <div>
                <label style={{ 
                  display: 'block',
                  color: 'var(--color-text-primary)', 
                  fontSize: '1.25rem', 
                  fontWeight: 700,
                  marginBottom: 4,
                  letterSpacing: '-0.01em'
                }}>
                  Your Company
                </label>
                <p style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  color: 'var(--color-text-tertiary)'
                }}>Currently analyzing this company</p>
              </div>
            </div>
            
            <div
              style={{ 
                width: '100%',
                background: '#f8fafc', 
                color: 'var(--color-text-primary)', 
                fontSize: '1.125rem',
                fontWeight: 600,
                border: '2px solid var(--color-border)', 
                borderRadius: 12,
                padding: '16px 20px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>🏢</span>
              <span>{companies.find(c => c.id === selectedCompany)?.name || 'No company selected'}</span>
            </div>

            {companies.length === 0 && (
              <p style={{
                marginTop: '12px',
                padding: '12px 16px',
                background: '#fef3c7',
                border: '1px solid #fbbf24',
                borderRadius: '8px',
                color: '#92400e',
                fontSize: '0.875rem'
              }}>
                ℹ️ No companies found. Please register a company first.
              </p>
            )}
          </div>
          
          {/* SWOT Display - Premium Card */}
          {swot && !showReportModal && (
            <div style={{ 
              marginBottom: 32,
              background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
              border: '1px solid var(--color-border)',
              borderRadius: 16,
              padding: 32,
              boxShadow: '0 8px 32px rgba(22, 119, 255, 0.12)',
              position: 'relative',
              overflow: 'hidden',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 12px 48px rgba(22, 119, 255, 0.18)'}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 8px 32px rgba(22, 119, 255, 0.12)'}
            >
              {/* Decorative gradient overlay */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-light) 100%)'
              }}></div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-light) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  boxShadow: '0 4px 12px rgba(22, 119, 255, 0.25)'
                }}>📊</div>
                <div>
                  <h3 style={{ 
                    margin: 0, 
                    color: 'var(--color-primary)', 
                    fontWeight: 700,
                    fontSize: '1.5rem',
                    letterSpacing: '-0.02em'
                  }}>SWOT Analysis Complete</h3>
                  <p style={{ 
                    margin: '4px 0 0 0', 
                    color: 'var(--color-text-tertiary)',
                    fontSize: '0.875rem'
                  }}>Your comprehensive competitive analysis is ready</p>
                </div>
              </div>
              
              <button 
                className="btn btn-primary"
                onClick={() => setShowReportModal(true)}
                style={{
                  background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-light) 100%)',
                  border: 'none',
                  padding: '12px 32px',
                  fontSize: '1rem',
                  fontWeight: 600,
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(22, 119, 255, 0.25)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(22, 119, 255, 0.35)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(22, 119, 255, 0.25)';
                }}
              >
                <span style={{ marginRight: 8 }}>📄</span>
                View Full SWOT Report
              </button>
            </div>
          )}

          {/* Action Plan Section - Premium Card */}
          <div className="action-plan-section" style={{ 
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            border: '1px solid var(--color-border)',
            borderRadius: 16,
            padding: 32,
            boxShadow: '0 8px 32px rgba(22, 119, 255, 0.12)',
            position: 'relative',
            overflow: 'hidden',
            transition: 'all 0.3s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 12px 48px rgba(22, 119, 255, 0.18)'}
          onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 8px 32px rgba(22, 119, 255, 0.12)'}
          >
            {/* Decorative gradient overlay */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: 'linear-gradient(90deg, var(--color-success) 0%, #4ade80 100%)'
            }}></div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'linear-gradient(135deg, var(--color-success) 0%, #4ade80 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)'
              }}>📋</div>
              <div>
                <h3 style={{ 
                  margin: 0, 
                  color: 'var(--color-primary)', 
                  fontWeight: 700,
                  fontSize: '1.5rem',
                  letterSpacing: '-0.02em'
                }}>Action Plan Generator</h3>
                <p style={{ 
                  margin: '4px 0 0 0', 
                  color: 'var(--color-text-tertiary)',
                  fontSize: '0.875rem'
                }}>Create strategic action plans based on competitor analysis</p>
              </div>
            </div>
        {/* Premium Form Section */}
        <div style={{ 
          background: 'rgba(22, 119, 255, 0.02)',
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
          border: '1px solid rgba(22, 119, 255, 0.1)'
        }}>
          <label style={{ 
            display: 'block',
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Select Competitor
          </label>
          <select
            className="form-select"
            value={selectedActionCompetitor || ""}
            onChange={e => setSelectedActionCompetitor(e.target.value)}
            disabled={!selectedCompany || (availableCompetitors.length === 0)}
            style={{ 
              width: '100%',
              padding: '12px 16px',
              fontSize: '1rem',
              border: '2px solid var(--color-border)',
              borderRadius: 8,
              background: '#ffffff',
              color: 'var(--color-text-primary)',
              fontWeight: 500,
              transition: 'all 0.2s ease',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.04)'
            }}
            aria-label="Select competitor to view action plan"
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-primary)';
              e.currentTarget.style.boxShadow = '0 0 0 3px rgba(22, 119, 255, 0.1)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.04)';
            }}
          >
            <option value="">Select a competitor to analyze...</option>
            {availableCompetitors.map((comp, index) => (
              <option key={`${comp.COMPANY_ID}-${index}`} value={comp.COMPANY_ID}>
                {comp.NAME}
              </option>
            ))}
          </select>
        </div>
        
        {/* Only one set of Action Plan form fields rendered */}
        <div className="action-plan-form-sections" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: 12
            }}>
              <span style={{ fontSize: '1.25rem' }}>💬</span>
              Additional Context/Feedback
              <span style={{ 
                fontSize: '0.75rem',
                fontWeight: 400,
                color: 'var(--color-text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>(Optional)</span>
            </label>
            <textarea
              className="form-textarea"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Enter any specific requirements, constraints, or feedback for the action plan..."
              rows={4}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '0.9375rem',
                lineHeight: 1.6,
                border: '2px solid var(--color-border)',
                borderRadius: 8,
                background: '#ffffff',
                color: 'var(--color-text-primary)',
                resize: 'vertical',
                minHeight: 120,
                fontFamily: 'inherit',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.04)'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary)';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(22, 119, 255, 0.1)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.04)';
              }}
            />
            <div style={{ 
              fontSize: '0.8125rem', 
              color: 'var(--color-text-tertiary)',
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <span style={{ fontSize: '1rem' }}>💡</span>
              This input will be considered when generating or regenerating the action plan.
            </div>
          </div>
          
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: 12
            }}>
              <span style={{ fontSize: '1.25rem' }}>📊</span>
              Action Plan Status:
            </label>
            <select
              className="form-select"
              value={actionPlanStatus}
              onChange={(e) => setActionPlanStatus(e.target.value)}
              style={{ 
                width: '100%',
                maxWidth: 300,
                padding: '12px 16px',
                fontSize: '1rem',
                border: '2px solid var(--color-border)',
                borderRadius: 8,
                background: '#ffffff',
                color: 'var(--color-text-primary)',
                fontWeight: 500,
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.04)'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary)';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(22, 119, 255, 0.1)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.04)';
              }}
            >
              <option value="pending">⏳ Pending</option>
              <option value="in-progress">🔄 In Progress</option>
              <option value="done">✅ Done</option>
              <option value="skipped">⏭️ Skipped</option>
            </select>
            <div style={{ 
              fontSize: '0.8125rem', 
              color: 'var(--color-text-tertiary)',
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <span style={{ fontSize: '1rem' }}>ℹ️</span>
              Select the current status of this action plan. This will influence the AI's recommendations.
            </div>
          </div>
          
          {/* Action Plan Buttons */}
          <div style={{ 
            display: 'flex', 
            gap: '12px', 
            flexWrap: 'wrap',
            marginTop: 24,
            marginBottom: 24
          }}>
            <button 
              onClick={generateActionPlan}
              disabled={!selectedCompany || !selectedActionCompetitor || loadingActionPlan}
              style={{ 
                flex: '1 1 auto',
                minWidth: '200px',
                padding: '14px 24px',
                background: (!selectedCompany || !selectedActionCompetitor || loadingActionPlan) 
                  ? 'var(--color-bg-tertiary)' 
                  : 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-light) 100%)',
                border: 'none',
                borderRadius: '8px',
                cursor: (!selectedCompany || !selectedActionCompetitor || loadingActionPlan) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: 600,
                opacity: (!selectedCompany || !selectedActionCompetitor || loadingActionPlan) ? 0.5 : 1,
                boxShadow: (!selectedCompany || !selectedActionCompetitor || loadingActionPlan) 
                  ? 'none' 
                  : '0 4px 12px rgba(22, 119, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(22, 119, 255, 0.35)';
                }
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(22, 119, 255, 0.25)';
                }
              }}
            >
              <span style={{ fontSize: '18px' }}>🔄</span>
              {loadingActionPlan ? 'Generating...' : 'Generate Action Plan'}
            </button>
            
            <button 
              onClick={fetchPreviousActionPlans}
              disabled={!selectedCompany || !selectedActionCompetitor}
              style={{ 
                flex: '1 1 auto',
                minWidth: '200px',
                padding: '14px 24px',
                background: (!selectedCompany || !selectedActionCompetitor) 
                  ? 'var(--color-bg-tertiary)' 
                  : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                border: 'none',
                borderRadius: '8px',
                cursor: (!selectedCompany || !selectedActionCompetitor) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: 600,
                opacity: (!selectedCompany || !selectedActionCompetitor) ? 0.5 : 1,
                boxShadow: (!selectedCompany || !selectedActionCompetitor) 
                  ? 'none' 
                  : '0 4px 12px rgba(99, 102, 241, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(99, 102, 241, 0.35)';
                }
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.25)';
                }
              }}
            >
              <span style={{ fontSize: '18px' }}>📜</span>
              Show Previous Plan
            </button>
          </div>
        </div>
          </div> {/* End Action Plan Section */}
        </div> {/* End Main Content Area */}
      </div> {/* End Dashboard Layout with Sidebar */}

      {/* Saved Action Plans Modal - moved outside button group and action plan section */}
      {showSavedActionPlansModal && (
        <div className="modal-overlay" onClick={() => setShowSavedActionPlansModal(false)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2100,
          overflowY: 'auto',
          boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h3 style={{ margin: 0, color: '#1677ff', fontWeight: 600 }}>
              {selectedSavedActionPlan ? 'Action Plan Details' : 'Saved Action Plans'}
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedSavedActionPlan && (
                <button
                  onClick={() => setSelectedSavedActionPlan(null)}
                  style={{
                    background: '#f0f0f0',
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: '#666'
                  }}
                >
                  ← Back to List
                </button>
              )}
              <button
                onClick={() => setShowSavedActionPlansModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 24,
                  cursor: 'pointer',
                  color: '#666',
                  padding: 4
                }}
              >
                ✕
              </button>
            </div>
          </div>
          {!selectedSavedActionPlan ? (
            <div>
              {loadingSavedActionPlans ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <div className="loader" style={{
                    width: 40, height: 40, margin: '0 auto 16px', border: '4px solid #eee', borderTop: '4px solid #1677ff', borderRadius: '50%', animation: 'spin 1s linear infinite'
                  }} />
                  <p>Loading saved action plans...</p>
                </div>
              ) : savedActionPlans.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
                  <p>No saved action plans found for this competitor.</p>
                  <p style={{ fontSize: 14, marginTop: 8 }}>Generate some action plans first to see them here.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  {savedActionPlans.map((plan, index) => (
                    <div
                      key={index}
                      className="saved-action-plans-list plan-item"
                      style={{
                        border: '1px solid #e6e9ee',
                        borderRadius: 8,
                        padding: 20,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        background: '#fff'
                      }}
                      onClick={() => setSelectedSavedActionPlan(plan)}
                      onMouseEnter={e => {
                        e.target.style.borderColor = '#1677ff';
                        e.target.style.transform = 'translateY(-2px)';
                        e.target.style.boxShadow = '0 4px 12px rgba(22, 119, 255, 0.15)';
                      }}
                      onMouseLeave={e => {
                        e.target.style.borderColor = '#e6e9ee';
                        e.target.style.transform = 'translateY(0)';
                        e.target.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <h4 style={{ margin: 0, color: '#1677ff', fontSize: 18, fontWeight: 600 }}>Action Plan</h4>
                        <span style={{ color: '#888', fontSize: 13, fontWeight: 500 }}>
                          {plan.CREATED_AT ? new Date(plan.CREATED_AT).toLocaleString() : 'Unknown date'}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: '#888', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>Status: {plan.STATUS || 'unknown'}</span>
                        <span>Click to view details</span>
                        <span style={{ fontSize: 16 }}>→</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ background: '#f8faff', border: '1px solid #e1e8ff', borderRadius: 8, padding: 20, marginBottom: 20 }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#1677ff', fontSize: 20 }}>Action Plan</h4>
                <div style={{ display: 'flex', gap: 24, fontSize: 14, color: '#666' }}>
                  <span><strong>Status:</strong> {selectedSavedActionPlan.STATUS || 'unknown'}</span>
                  <span><strong>Generated:</strong> {selectedSavedActionPlan.CREATED_AT ? new Date(selectedSavedActionPlan.CREATED_AT).toLocaleString() : 'Unknown date'}</span>
                </div>
              </div>
              <div className="report-content" style={{ maxHeight: 'calc(90vh - 240px)', overflowY: 'auto', padding: 24, backgroundColor: '#fff', borderRadius: 8, fontSize: 15, lineHeight: 1.7, border: '1px solid #e6e9ee' }}>
                <div dangerouslySetInnerHTML={{ __html: marked.parse(selectedSavedActionPlan.USER_INPUT || selectedSavedActionPlan.STEP_ACTION || '') }} />
              </div>
            </div>
          )}
        </div>
      )}
      {/* Removed bottom duplicate Action Plan form block */}

      {/* SWOT Report Modal */}
      {swot && showReportModal && (
        <div style={modalOverlayStyle} onClick={() => setShowReportModal(false)}>
          <div className="modal report-modal" style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div className="report-content" style={{ maxHeight: '70vh', overflowY: 'auto', padding: 24 }}>
              <h3 style={{ margin: 0, marginBottom: 20, color: '#1677ff' }}>SWOT Analysis Report</h3>
              <div dangerouslySetInnerHTML={{ __html: marked.parse(typeof swot === 'string' ? swot : JSON.stringify(swot, null, 2)) }} />
            </div>
            <button className="btn btn-secondary" onClick={() => setShowReportModal(false)} style={{ marginTop: 16 }}>Close</button>
          </div>
        </div>
      )}

      {/* Modals moved to the bottom so they are grouped and rendered after main UI */}
      {/* Preferences Modal */}
      {showPreferencesModal && (
        <div style={modalOverlayStyle} onClick={() => setShowPreferencesModal(false)}>
          <div className="modal preferences-modal" ref={preferencesModalRef} style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ margin: 0, color: '#1677ff', fontWeight: 600, fontSize: '1.5rem' }}></h3>
              <button
                onClick={() => setShowPreferencesModal(false)}
                style={{
                  padding: '8px 16px',
                  background: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '14px',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#e5e7eb';
                  e.currentTarget.style.borderColor = '#9ca3af';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f3f4f6';
                  e.currentTarget.style.borderColor = '#d1d5db';
                }}
              >
                Close
              </button>
            </div>
            
            <button 
              onClick={openCreatePreferenceModal} 
              style={{ 
                marginBottom: 20,
                padding: '10px 20px',
                background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-light) 100%)',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '14px'
              }}
            >
              + Create New Preference
            </button>
            
            {preferences.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
                <p>No preferences found. Create one to get started.</p>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {preferences.map(pref => (
                  <li key={pref.prefId} style={{ 
                    marginBottom: 16, 
                    padding: 16, 
                    border: selectedPreferenceId === pref.prefId ? '2px solid #1677ff' : '1px solid #e5e7eb',
                    backgroundColor: selectedPreferenceId === pref.prefId ? '#eff6ff' : '#ffffff',
                    borderRadius: 8,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    transition: 'all 0.2s ease'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong style={{ fontSize: '16px', color: '#111827' }}>{pref.name}</strong>
                          {selectedPreferenceId === pref.prefId && (
                            <span style={{ 
                              padding: '3px 8px', 
                              backgroundColor: '#1677ff', 
                              color: 'white', 
                              fontSize: 11, 
                              borderRadius: 4,
                              fontWeight: 600
                            }}>
                              ✓ SELECTED
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
                          Time Range: <strong>{pref.timeRange}</strong> • Competitors: <strong>{pref.competitorIds?.length || 0}</strong>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button 
                        onClick={() => {
                          setSelectedPreferenceId(pref.prefId);
                          setShowPreferencesModal(false);
                        }} 
                        disabled={selectedPreferenceId === pref.prefId}
                        style={{
                          padding: '8px 16px',
                          background: selectedPreferenceId === pref.prefId ? '#e5e7eb' : '#1677ff',
                          color: selectedPreferenceId === pref.prefId ? '#6b7280' : 'white',
                          border: 'none',
                          borderRadius: 6,
                          cursor: selectedPreferenceId === pref.prefId ? 'not-allowed' : 'pointer',
                          fontWeight: 500,
                          fontSize: '13px'
                        }}
                      >
                        {selectedPreferenceId === pref.prefId ? 'Selected' : 'Select'}
                      </button>
                      <button 
                        onClick={() => openEditPreferenceModal(pref)} 
                        style={{
                          padding: '8px 16px',
                          background: '#f3f4f6',
                          color: '#374151',
                          border: '1px solid #d1d5db',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontWeight: 500,
                          fontSize: '13px'
                        }}
                      >
                        Edit
                      </button>
                      <button 
                        onClick={() => deletePreference(pref.prefId)}
                        style={{
                          padding: '8px 16px',
                          background: '#fee2e2',
                          color: '#dc2626',
                          border: '1px solid #fecaca',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontWeight: 500,
                          fontSize: '13px'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Create Preference Modal */}
      {showCreatePreferenceModal && (
        <div className="modal-overlay" onClick={() => setShowCreatePreferenceModal(false)}>
          <div
            className="modal-content animate-scaleIn"
            ref={createPreferenceModalRef}
            onClick={(e) => e.stopPropagation()}
            style={{ 
              padding: '32px', 
              width: '600px',
              maxWidth: '90vw',
              maxHeight: '85vh',
              overflowY: 'auto',
              display: 'flex', 
              flexDirection: 'column', 
              gap: '20px'
            }}
          >
            <h3 style={{ margin: 0, fontSize: '24px', fontWeight: '600', color: '#1a1a1a' }}>Create New Preference</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>Preference Name</label>
              <input
                type="text"
                placeholder="Enter preference name"
                value={createPrefForm.name}
                onChange={e => setCreatePrefForm({ ...createPrefForm, name: e.target.value })}
                style={{ 
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '14px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#1677ff'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              />
            </div>
            
            <div>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '500', color: '#374151' }}>Select Competitors</h4>
              <div style={{ 
                maxHeight: '240px', 
                overflowY: 'auto', 
                border: '1px solid #e5e7eb', 
                borderRadius: '8px', 
                padding: '12px',
                backgroundColor: '#f9fafb'
              }}>
                {availableCompetitors.map((comp, index) => (
                  <label 
                    key={`create-${comp.COMPANY_ID}-${index}`} 
                    style={{ 
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px',
                      cursor: 'pointer',
                      borderRadius: '6px',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <input
                      type="checkbox"
                      checked={createPrefForm.competitorIds.includes(comp.COMPANY_ID)}
                      onChange={e => handleCreatePrefCompetitorSelection(comp.COMPANY_ID, e.target.checked)}
                      style={{ marginRight: '12px', cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <span style={{ fontSize: '14px', color: '#1f2937' }}>{comp.NAME}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
              <button 
                onClick={() => setShowCreatePreferenceModal(false)}
                style={{
                  padding: '10px 24px',
                  fontSize: '14px',
                  fontWeight: '500',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: 'white',
                  color: '#374151',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f9fafb'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
              >
                Cancel
              </button>
              <button 
                onClick={savePreference} 
                disabled={savingPreference}
                style={{
                  padding: '10px 24px',
                  fontSize: '14px',
                  fontWeight: '500',
                  border: 'none',
                  borderRadius: '8px',
                  backgroundColor: savingPreference ? '#93c5fd' : '#1677ff',
                  color: 'white',
                  cursor: savingPreference ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => !savingPreference && (e.target.style.backgroundColor = '#0958d9')}
                onMouseLeave={(e) => !savingPreference && (e.target.style.backgroundColor = '#1677ff')}
              >
                {savingPreference ? "Saving..." : "Save Preference"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Preference Modal */}
      {showEditPreferenceModal && editPrefForm && (
        <div className="modal edit-preference-modal">
          <div
            className="modal-content"
            ref={editPreferenceModalRef}
            style={{ padding: 24, width: 'min(560px, 92vw)', display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <h3>Edit Preference</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 14, color: '#555' }}>Preference Name</label>
              <input
                type="text"
                placeholder="Preference Name"
                value={editPrefForm.name}
                onChange={e => setEditPrefForm({ ...editPrefForm, name: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <h4 style={{ margin: '12px 0 8px' }}>Select Competitors:</h4>
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6, padding: 8 }}>
                {availableCompetitors.map((comp, index) => (
                  <label key={`edit-${comp.COMPANY_ID}-${index}`} style={{ display: 'block', padding: '4px 2px' }}>
                    <input
                      type="checkbox"
                      checked={editPrefForm.competitorIds.includes(comp.COMPANY_ID)}
                      onChange={e => handleEditPrefCompetitorSelection(comp.COMPANY_ID, e.target.checked)}
                      style={{ marginRight: 8 }}
                    />
                    {comp.NAME}
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button onClick={saveEditPreference} disabled={savingEditPreference}>
                {savingEditPreference ? "Saving..." : "Save"}
              </button>
              <button onClick={() => setShowEditPreferenceModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Competitors Modal */}
      {showCompetitorsModal && (
        <div className="modal-overlay" onClick={() => setShowCompetitorsModal(false)}>
          <div 
            className="modal-content animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '32px',
              width: '700px',
              maxWidth: '90vw',
              maxHeight: '85vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '24px'
            }}
          >
            <h3 style={{ margin: 0, fontSize: '24px', fontWeight: '600', color: '#1a1a1a' }}>Competitors</h3>
            
            {competitors.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: '14px', textAlign: 'center', padding: '40px 0' }}>
                No competitors added yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {competitors.map((comp, idx) => (
                  <div 
                    key={comp.COMPANY_ID || idx}
                    style={{
                      padding: '16px 20px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      backgroundColor: '#f9fafb',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f3f4f6';
                      e.currentTarget.style.borderColor = '#d1d5db';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#f9fafb';
                      e.currentTarget.style.borderColor = '#e5e7eb';
                    }}
                  >
                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#1f2937', marginBottom: '4px' }}>
                      {comp.NAME}
                    </div>
                    {comp.WEBSITE && (
                      <div style={{ fontSize: '14px', color: '#6b7280' }}>
                        🌐 {comp.WEBSITE}
                      </div>
                    )}
                    {comp.INDUSTRY && (
                      <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>
                        Industry: {comp.INDUSTRY}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
              <button 
                onClick={() => setShowCompetitorsModal(false)}
                style={{
                  padding: '10px 24px',
                  fontSize: '14px',
                  fontWeight: '500',
                  border: 'none',
                  borderRadius: '8px',
                  backgroundColor: '#1677ff',
                  color: 'white',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#0958d9'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#1677ff'}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Competitor Modal */}
      {showAddCompetitorModal && (
        <div className="modal-overlay" onClick={() => setShowAddCompetitorModal(false)} style={{ alignItems: 'flex-start', paddingTop: '120px' }}>
          <div 
            className="modal-content animate-scaleIn"
            ref={addCompetitorModalRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '32px',
              width: '600px',
              maxWidth: '90vw',
              maxHeight: '80vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}
          >
            <h3 style={{ margin: 0, fontSize: '24px', fontWeight: '600', color: '#1a1a1a' }}>Add Competitor</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>Competitor Name *</label>
              <input
                type="text"
                placeholder="Enter competitor name"
                value={newCompetitor.name}
                onChange={e => setNewCompetitor({ ...newCompetitor, name: e.target.value })}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '14px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#1677ff'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>Website</label>
              <input
                type="text"
                placeholder="https://example.com"
                value={newCompetitor.website}
                onChange={e => setNewCompetitor({ ...newCompetitor, website: e.target.value })}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '14px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#1677ff'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>Industry</label>
              <input
                type="text"
                placeholder="e.g., Technology, Healthcare, Finance"
                value={newCompetitor.industry}
                onChange={e => setNewCompetitor({ ...newCompetitor, industry: e.target.value })}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '14px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#1677ff'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>Region/Location</label>
              <input
                type="text"
                placeholder="e.g., New York, USA or London, UK"
                value={newCompetitor.region}
                onChange={e => setNewCompetitor({ ...newCompetitor, region: e.target.value })}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '14px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#1677ff'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              />
            </div>
            
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '500', color: '#374151' }}>Social Media Links</h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280' }}>Facebook URL</label>
                  <input
                    type="text"
                    placeholder="https://facebook.com/..."
                    value={newCompetitor.facebookUrl}
                    onChange={e => setNewCompetitor({ ...newCompetitor, facebookUrl: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      outline: 'none'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#1677ff'}
                    onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                  />
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280' }}>Instagram URL</label>
                  <input
                    type="text"
                    placeholder="https://instagram.com/..."
                    value={newCompetitor.instagramUrl}
                    onChange={e => setNewCompetitor({ ...newCompetitor, instagramUrl: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      outline: 'none'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#1677ff'}
                    onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                  />
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280' }}>LinkedIn URL</label>
                  <input
                    type="text"
                    placeholder="https://linkedin.com/company/..."
                    value={newCompetitor.linkedinUrl}
                    onChange={e => setNewCompetitor({ ...newCompetitor, linkedinUrl: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      outline: 'none'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#1677ff'}
                    onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                  />
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280' }}>Google Review URL</label>
                  <input
                    type="text"
                    placeholder="https://maps.app.goo.gl/..."
                    value={newCompetitor.googleReviewUrl}
                    onChange={e => setNewCompetitor({ ...newCompetitor, googleReviewUrl: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      outline: 'none'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#1677ff'}
                    onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                  />
                </div>
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
              <button 
                onClick={() => setShowAddCompetitorModal(false)}
                style={{
                  padding: '10px 24px',
                  fontSize: '14px',
                  fontWeight: '500',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: 'white',
                  color: '#374151',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f9fafb'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
              >
                Cancel
              </button>
              <button 
                onClick={addCompetitor}
                disabled={isAddingCompetitor}
                style={{
                  padding: '10px 24px',
                  fontSize: '14px',
                  fontWeight: '500',
                  border: 'none',
                  borderRadius: '8px',
                  backgroundColor: isAddingCompetitor ? '#93c5fd' : '#1677ff',
                  color: 'white',
                  cursor: isAddingCompetitor ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => !isAddingCompetitor && (e.target.style.backgroundColor = '#0958d9')}
                onMouseLeave={(e) => !isAddingCompetitor && (e.target.style.backgroundColor = '#1677ff')}
              >
                {isAddingCompetitor ? "Adding..." : "Add Competitor"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal (Viewer) */}
      {showReportModal && reportResult && (
        <div style={modalOverlayStyle} onClick={() => setShowReportModal(false)}>
          <div className="modal report-modal" style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div className="report-content">
              {/* Render markdown if present, fallback to plain text */}
              {reportResult.content
                ? <div dangerouslySetInnerHTML={{ __html: marked.parse(reportResult.content) }} />
                : <pre>{JSON.stringify(reportResult, null, 2)}</pre>
              }
            </div>
            <button className="btn btn-secondary" onClick={() => setShowReportModal(false)} style={{ marginTop: 16 }}>Close</button>
            <button className="btn btn-primary" onClick={exportCurrentReportAsPDF} style={{ marginTop: 16, marginLeft: 8 }}>Export as PDF</button>
          </div>
        </div>
      )}

      {/* Add ApiKeyManager modal */}
      {showApiManager && (
        <div className="modal api-manager-modal" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{
            width: '92%',
            maxWidth: 900,
            maxHeight: '90vh',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 8,
            padding: 16,
            boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
          }}>
            <button
              onClick={() => setShowApiManager(false)}
              style={{ float: 'right', marginBottom: 8, background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer' }}
              aria-label="Close API Manager"
            >
              ✕
            </button>
            {/* Pass user/firm ids and a close handler */}
            <ApiKeyManager userid={userID} firmid={firmID} onClose={() => setShowApiManager(false)} />
          </div>
        </div>
      )}

      {/* Missing Info Modal */}
      {showMissingInfoModal && (
        <div className="modal missing-info-modal" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2100
        }}>
          <div style={{
            background: '#fff',
            padding: 32,
            borderRadius: 10,
            maxWidth: 400,
            width: '90%',
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
          }}>
            <h3 style={{ marginTop: 0 }}>Missing Information</h3>
            <div style={{ marginBottom: 18, whiteSpace: 'pre-line', color: '#444' }}>
              {missingInfoMessage}
            </div>
            <button onClick={() => setShowMissingInfoModal(false)} style={{
              background: '#1677ff',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 18px',
              cursor: 'pointer'
            }}>Close</button>
          </div>
        </div>
      )}

      {/* Export Progress Modal */}
      {showExportProgress && (
        <div className="modal export-progress-modal" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2200
        }}>
          <div style={{
            background: '#fff',
            padding: 32,
            borderRadius: 10,
            maxWidth: 400,
            width: '90%',
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
            textAlign: 'center'
          }}>
            <h3 style={{ marginTop: 0 }}>Exporting Reports...</h3>
            <div style={{ marginBottom: 18, color: '#444' }}>
              {exportProgressMsg}
            </div>
            <div className="loader" style={{
              width: 40, height: 40, margin: '0 auto', border: '4px solid #eee', borderTop: '4px solid #1677ff', borderRadius: '50%', animation: 'spin 1s linear infinite'
            }} />
          </div>
        </div>
      )}

      {/* Saved Reports Modal */}
      {showSavedReportsModal && (
        <div className="modal-overlay" onClick={() => setShowSavedReportsModal(false)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#fff',
            padding: 32,
            borderRadius: 10,
            maxWidth: selectedSavedReport ? '95%' : '900px',
            width: selectedSavedReport ? '95%' : '90%',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ margin: 0, color: '#1677ff', fontWeight: 600 }}>
                {selectedSavedReport ? 'Report Details' : `Saved Reports - ${companies.find(c => c.company_id === selectedCompany)?.name || 'Selected Company'}`}
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedSavedReport && (
                  <button 
                    onClick={() => setSelectedSavedReport(null)}
                    style={{
                      background: '#f0f0f0',
                      border: '1px solid #ddd',
                      borderRadius: 6,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontSize: 14,
                      color: '#666'
                    }}
                  >
                    ← Back to List
                  </button>
                )}
                <button 
                  onClick={() => setShowSavedReportsModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 24,
                    cursor: 'pointer',
                    color: '#666',
                    padding: 4
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            
            {!selectedSavedReport ? (
              // Reports List View
              <div>
                {loadingSavedReports ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <div className="loader" style={{
                      width: 40, height: 40, margin: '0 auto 16px', border: '4px solid #eee', borderTop: '4px solid #1677ff', borderRadius: '50%', animation: 'spin 1s linear infinite'
                    }} />
                    <p>Loading saved reports...</p>
                  </div>
                ) : savedReports.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
                    <p>No saved reports found for this company.</p>
                    <p style={{ fontSize: 14, marginTop: 8 }}>Generate some reports first to see them here.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 16 }}>
                    {savedReports.map((report, index) => (
                      <div 
                        key={index}
                        className="saved-reports-list report-item"
                        style={{
                          border: '1px solid #e6e9ee',
                          borderRadius: 8,
                          padding: 20,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          background: '#fff'
                        }}
                        onClick={() => setSelectedSavedReport(report)}
                        onMouseEnter={(e) => {
                          e.target.style.borderColor = '#1677ff';
                          e.target.style.transform = 'translateY(-2px)';
                          e.target.style.boxShadow = '0 4px 12px rgba(22, 119, 255, 0.15)';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.borderColor = '#e6e9ee';
                          e.target.style.transform = 'translateY(0)';
                          e.target.style.boxShadow = 'none';
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                          <h4 style={{ margin: 0, color: '#1677ff', fontSize: 18, fontWeight: 600 }}>{report.BOOK_TITLE}</h4>
                          <span style={{ color: '#888', fontSize: 13, fontWeight: 500 }}>
                            {new Date(report.CREATED_DATE).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 20, fontSize: 14, color: '#666', marginBottom: 8 }}>
                          <span><strong>Type:</strong> {report.BOOK_TYPE.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                          <span><strong>Company:</strong> {report.COMPANY_NAME || 'Unknown'}</span>
                        </div>
                        <div style={{ 
                          fontSize: 13, 
                          color: '#888', 
                          fontStyle: 'italic',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}>
                          <span>Click to view full report</span>
                          <span style={{ fontSize: 16 }}>→</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // Single Report View
              <div>
                <div style={{
                  background: '#f8faff',
                  border: '1px solid #e1e8ff',
                  borderRadius: 8,
                  padding: 20,
                  marginBottom: 20
                }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#1677ff', fontSize: 20 }}>{selectedSavedReport.BOOK_TITLE}</h4>
                  <div style={{ display: 'flex', gap: 24, fontSize: 14, color: '#666' }}>
                    <span><strong>Type:</strong> {selectedSavedReport.BOOK_TYPE.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                    <span><strong>Company:</strong> {selectedSavedReport.COMPANY_NAME || 'Unknown'}</span>
                    <span><strong>Generated:</strong> {new Date(selectedSavedReport.CREATED_DATE).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}</span>
                  </div>
                </div>
                <div className="report-content" style={{
                  maxHeight: 'calc(90vh - 240px)',
                  overflowY: 'auto',
                  padding: 24,
                  backgroundColor: '#fff',
                  borderRadius: 8,
                  fontSize: 15,
                  lineHeight: 1.7,
                  border: '1px solid #e6e9ee'
                }}>
                  <div dangerouslySetInnerHTML={{ __html: marked.parse(selectedSavedReport.BOOK_CONTENT || '') }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notification */}
      {notification.visible && (
        <div className={`notification ${notification.type} animate-slideDown`} style={{
          position: 'fixed',
          top: '24px',
          left: '50%',
          marginLeft: '-250px',
          width: '500px',
          background: notification.type === 'error' ? '#fee2e2' : notification.type === 'info' ? '#dbeafe' : '#d1fae5',
          color: notification.type === 'error' ? '#b91c1c' : notification.type === 'info' ? '#1e40af' : '#065f46',
          padding: '16px 32px',
          borderRadius: '12px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
          zIndex: 10000,
          fontSize: '14px',
          fontWeight: '500',
          textAlign: 'center',
          border: notification.type === 'error' ? '2px solid #b91c1c' : notification.type === 'info' ? '2px solid #1e40af' : '2px solid #065f46'
        }}>
          {notification.message}
        </div>
      )}

      {/* Action Plan Modal */}
      {showActionPlanModal && (
        <div style={modalOverlayStyle} onClick={() => setShowActionPlanModal(false)}>
          <div className="modal report-modal" style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div className="report-content" style={{ maxHeight: '70vh', overflowY: 'auto', padding: 24 }}>
              <h3 style={{ margin: 0, marginBottom: 20, color: '#1677ff' }}>Action Plan</h3>
            
            {loadingActionPlan ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div className="loader" style={{ 
                  width: 40, 
                  height: 40, 
                  margin: '0 auto 16px', 
                  border: '4px solid #eee', 
                  borderTop: '4px solid #1677ff', 
                  borderRadius: '50%', 
                  animation: 'spin 1s linear infinite' 
                }} />
                <p>Loading action plan...</p>
              </div>
            ) : actionPlan ? (
              <div style={{ color: '#111827', fontSize: 15, lineHeight: 1.7 }}>
                {/* Handle different action plan data structures */}
                {(() => {
                  console.log('Rendering actionPlan:', actionPlan);
                  
                  let contentToRender = '';
                  
                  // Handle different data types and structures
                  if (actionPlan.content) {
                    if (typeof actionPlan.content === 'string' && actionPlan.content.trim()) {
                      contentToRender = actionPlan.content;
                    } else if (typeof actionPlan.content === 'object') {
                      // If content is an object, try to stringify it or extract text content
                      contentToRender = JSON.stringify(actionPlan.content, null, 2);
                    }
                  } else if (typeof actionPlan === 'string' && actionPlan.trim()) {
                    contentToRender = actionPlan;
                  } else if (actionPlan.report) {
                    if (typeof actionPlan.report === 'string' && actionPlan.report.trim()) {
                      contentToRender = actionPlan.report;
                    } else if (typeof actionPlan.report === 'object') {
                      contentToRender = JSON.stringify(actionPlan.report, null, 2);
                    }
                  } else if (typeof actionPlan === 'object') {
                    // Last resort: stringify the entire object
                    contentToRender = JSON.stringify(actionPlan, null, 2);
                  }
                  
                  // Ensure we always have a string before passing to marked.parse
                  if (contentToRender && typeof contentToRender === 'string' && contentToRender.trim()) {
                    return <div dangerouslySetInnerHTML={{ __html: marked.parse(contentToRender) }} />;
                  } else {
                    return (
                      <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
                        <p>No action plan content available.</p>
                        <pre style={{ fontSize: 12, color: '#999', textAlign: 'left' }}>
                          Debug: {JSON.stringify(actionPlan, null, 2)}
                        </pre>
                      </div>
                    );
                  }
                })()}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
                <p>No action plan content available.</p>
              </div>
            )}
          </div>
          <button className="btn btn-secondary" onClick={() => setShowActionPlanModal(false)} style={{ marginTop: 16 }}>Close</button>
          </div>
        </div>
      )}
        </div> {/* End max-width container */}
      </div> {/* End main content area */}
    </div>
  );
}

// Utility function to convert LLM action plan response to UI fields
// function renderActionPlanStep(step, idx) {
//   // This function is no longer needed since we're displaying bullet points
// }

// Export component
export default SocialMediaSwot;