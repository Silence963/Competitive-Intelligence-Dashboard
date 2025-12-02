// components/ApiKeyManager.js
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import LLMDetailsTable from "./LLMDetailsTable";
import "../styles/components.css";

const PROVIDER_TYPES = {
  IMAGE: 'TEXT-TO-IMAGE',
  CAPTION: 'IMAGE-TO-TEXT',
  TEXT: 'TEXT-TO-TEXT',
  MUSIC: 'TEXT-TO-MUSIC',
  VOICE: 'TEXT-TO-SPEECH',
  VIDEO: 'TEXT-TO-VIDEO'
};

const providersByCategory = {
  IMAGE_GENERATION: [
    { value: "TOGETHER_STABLE_DIFFUSION", label: "Together SD", description: "Cloud-based SD", tier: "Freemium", speed: "Fast", specialties: "All styles, fast gen", type: PROVIDER_TYPES.IMAGE },
    { value: "KANDINSKY", label: "Kandinsky", description: "Artistic styles", tier: "Freemium", speed: "Medium", specialties: "Abstract, paintings", type: PROVIDER_TYPES.IMAGE }
  ],
  CAPTION_GENERATION: [
    { value: "OPENAI_GPT4V", label: "OpenAI GPT-4V", description: "Best overall vision model", tier: "Premium", speed: "Medium", type: PROVIDER_TYPES.CAPTION },
    { value: "GEMINI_PRO_VISION", label: "Google Gemini Pro Vision", description: "Google's multimodal model", tier: "Premium", speed: "Fast", type: PROVIDER_TYPES.CAPTION },
    { value: "CLAUDE_3_OPUS", label: "Anthropic Claude 3 Opus", description: "High-accuracy vision model", tier: "Premium", speed: "Medium", type: PROVIDER_TYPES.CAPTION },
    { value: "LLAVA_13B", label: "LLaVA-13B", description: "Open-source vision model", tier: "Free", speed: "Slow", type: PROVIDER_TYPES.CAPTION },
    { value: "MINIGPT4", label: "MiniGPT-4", description: "Lightweight vision model", tier: "Free", speed: "Medium", type: PROVIDER_TYPES.CAPTION },
    { value: "INSTRUCTBLIP", label: "InstructBLIP", description: "Instruction-tuned vision model", tier: "Free", speed: "Fast", type: PROVIDER_TYPES.CAPTION },
    { value: "PHI3_VISION", label: "Phi-3 Vision", description: "Microsoft's small vision model", tier: "Freemium", speed: "Fast", type: PROVIDER_TYPES.CAPTION }
  ],
  LANGUAGE_TEXT: [
    { value: "PLAYHT", label: "PlayHT", description: "High-quality text generation and voice synthesis", tier: "Premium", speed: "Fast", type: PROVIDER_TYPES.TEXT },
    { value: "GROQ", label: "Groq", description: "Fastest inference speeds available", tier: "Freemium", speed: "Ultra Fast", type: PROVIDER_TYPES.TEXT },
    { value: "OPENROUTER", label: "OpenRouter", description: "Aggregates multiple providers", tier: "Freemium", speed: "Variable", type: PROVIDER_TYPES.TEXT },
    { value: "CLAUDE", label: "Anthropic Claude", description: "Balanced performance and quality", tier: "Premium", speed: "Fast", type: PROVIDER_TYPES.TEXT },
    { value: "OPENAI_GPT4", label: "OpenAI GPT-4", description: "Most capable model overall", tier: "Premium", speed: "Medium", type: PROVIDER_TYPES.TEXT },
    { value: "GEMINI", label: "Google Gemini", description: "Strong reasoning and coding", tier: "Premium", speed: "Fast", type: PROVIDER_TYPES.TEXT },
    { value: "MISTRAL", label: "Mistral AI", description: "High quality open weights", tier: "Freemium", speed: "Fast", type: PROVIDER_TYPES.TEXT },
    { value: "DEEPSEEK", label: "DeepSeek", description: "Strong coding and math", tier: "Freemium", speed: "Fast", type: PROVIDER_TYPES.TEXT },
    { value: "OLLAMA", label: "Ollama", description: "Run models locally", tier: "Free", speed: "Variable", type: PROVIDER_TYPES.TEXT },
    { value: "COHERE", label: "Cohere", description: "Enterprise-grade language AI", tier: "Premium", speed: "Fast", type: PROVIDER_TYPES.TEXT },
    { value: "TOGETHER_AI", label: "Together AI", description: "Multiple open models", tier: "Freemium", speed: "Fast", type: PROVIDER_TYPES.TEXT },
    { value: "REPLICATE", label: "Replicate", description: "Hosted open models", tier: "Pay-per-use", speed: "Variable", type: PROVIDER_TYPES.TEXT }
  ],
  MUSIC_GENERATION: [
    {
      value: "SUNO_AI",
      label: "Suno AI",
      description: "Best AI song generator with lyrics",
      tier: "Freemium",
      speed: "Medium",
      specialties: "Full songs, vocals, lyrics",
      type: PROVIDER_TYPES.MUSIC
    },
    {
      value: "UDIO",
      label: "Udio",
      description: "High-quality music generation",
      tier: "Premium",
      speed: "Medium",
      specialties: "Professional music tracks",
      type: PROVIDER_TYPES.MUSIC
    },
    {
      value: "MUSICGEN_META",
      label: "MusicGen (Meta)",
      description: "Open-source music generation",
      tier: "Free",
      speed: "Fast",
      specialties: "Instrumental tracks",
      type: PROVIDER_TYPES.MUSIC
    },
    {
      value: "AIVA",
      label: "AIVA",
      description: "AI composer for classical music",
      tier: "Freemium",
      speed: "Medium",
      specialties: "Classical, orchestral",
      type: PROVIDER_TYPES.MUSIC
    },
    {
      value: "MUBERT",
      label: "Mubert AI",
      description: "Royalty-free background music",
      tier: "Freemium",
      speed: "Fast",
      specialties: "Background music, ambient",
      type: PROVIDER_TYPES.MUSIC
    },
    {
      value: "SOUNDRAW",
      label: "Soundraw",
      description: "Customizable music tracks",
      tier: "Premium",
      speed: "Fast",
      specialties: "Custom length, tempo control",
      type: PROVIDER_TYPES.MUSIC
    }
  ],
  VOICE_SYNTHESIS: [
    {
      value: "PLAYHT",
      label: "PlayHT",
      description: "High-quality text-to-speech",
      tier: "Freemium",
      speed: "Fast",
      specialties: "Natural-sounding voices",
      type: PROVIDER_TYPES.VOICE
    },
    {
      value: "AMAZON_POLLY",
      label: "Amazon Polly",
      description: "AWS text-to-speech service",
      tier: "Pay-per-use",
      speed: "Fast",
      specialties: "Enterprise integration",
      type: PROVIDER_TYPES.VOICE
    },
    {
      value: "GOOGLE_TTS",
      label: "Google TTS",
      description: "Google's text-to-speech",
      tier: "Freemium",
      speed: "Fast",
      specialties: "Multilingual support",
      type: PROVIDER_TYPES.VOICE
    },
    {
      value: "IBM_WATSON",
      label: "IBM Watson TTS",
      description: "Enterprise-grade TTS",
      tier: "Premium",
      speed: "Medium",
      specialties: "Custom voices",
      type: PROVIDER_TYPES.VOICE
    },
    {
      value: "MURF_AI",
      label: "Murf AI",
      description: "Professional voice overs",
      tier: "Freemium",
      speed: "Fast",
      specialties: "Voice cloning, dubbing",
      type: PROVIDER_TYPES.VOICE
    },
    {
      value: "WELLSAID",
      label: "Wellsaid Labs",
      description: "Professional voice synthesis",
      tier: "Premium",
      speed: "Medium",
      specialties: "Professional voice dubbing",
      type: PROVIDER_TYPES.VOICE
    }
  ],
  VIDEO_GENERATION: [
    {
      value: "RUNWAY_GEN4",
      label: "Runway Gen-4",
      description: "Best overall video generator",
      tier: "Premium",
      speed: "Medium",
      specialties: "Character consistency, directing tools",
      type: PROVIDER_TYPES.VIDEO
    },
    {
      value: "OPENAI_SORA",
      label: "OpenAI Sora",
      description: "Complex scene generation",
      tier: "Premium",
      speed: "Slow",
      specialties: "Multi-part scenes, storyboard",
      type: PROVIDER_TYPES.VIDEO
    },
    {
      value: "GOOGLE_VEO2",
      label: "Google Veo 2",
      description: "Google's video AI model",
      tier: "Premium",
      speed: "Medium",
      specialties: "High-quality video synthesis",
      type: PROVIDER_TYPES.VIDEO
    },
    {
      value: "PIKA_2_2",
      label: "Pika 2.2",
      description: "User-friendly video generation",
      tier: "Freemium",
      speed: "Fast",
      specialties: "Easy interface, quick results",
      type: PROVIDER_TYPES.VIDEO
    },
    {
      value: "KLING_AI_2",
      label: "Kling AI 2.0",
      description: "High-quality video synthesis",
      tier: "Freemium",
      speed: "Medium",
      specialties: "Realistic movements, scenes",
      type: PROVIDER_TYPES.VIDEO
    },
    {
      value: "HAILUO_AI",
      label: "Hailuo AI",
      description: "Best free video generator",
      tier: "Free",
      speed: "Fast",
      specialties: "Character reference, camera control",
      type: PROVIDER_TYPES.VIDEO
    },
    {
      value: "WAN2_2",
      label: "Alibaba Wan2.2",
      description: "Open-source video generation",
      tier: "Free",
      speed: "Fast",
      specialties: "720P videos, consumer hardware",
      type: PROVIDER_TYPES.VIDEO
    }
  ]
};

// note: ancillary label/icon maps removed to satisfy no-unused-vars

const STORAGE_KEYS = {
  USER_ID: 'llm_user_id',
  FIRM_ID: 'llm_firm_id',
  ACTIVE_PROVIDER: 'llm_active_provider'
};

// Map long UI category names to DB-friendly short codes
const CATEGORY_DB_MAP = {
  LANGUAGE_TEXT: 'L',
  IMAGE_GENERATION: 'I',
  CAPTION_GENERATION: 'C',
  MUSIC_GENERATION: 'M',
  VOICE_SYNTHESIS: 'T',
  VIDEO_GENERATION: 'V'
};

const ApiKeyManager = ({
  onProviderSelect, 
  onClose, 
  userid, 
  firmid,
  apiBaseUrl = "http://localhost:5600/api" 
}) => {
  // Use the passed IDs or fetch from backend
  const [apiKey, setApiKey] = useState("");
  const [userId, setUserId] = useState(userid || '');
  const [firmId, setFirmId] = useState(firmid || '');
  const [selectedCategory, setSelectedCategory] = useState("");
  const [llmProvider, setLlmProvider] = useState("");
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [llmDetails, setLlmDetails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update local state when props change
  useEffect(() => {
    if (userid) setUserId(userid);
    if (firmid) setFirmId(firmid);
  }, [userid, firmid]);

  // No backend default IDs; rely solely on props or URL
  useEffect(() => {
    if(!userId || !firmId){
      const params = new URLSearchParams(window.location.search);
      const qU = params.get('userid');
      const qF = params.get('firmid');
      if(qU && !userId) setUserId(qU);
      if(qF && !firmId) setFirmId(qF);
    }
  }, [userId, firmId]);

  const fetchLLMDetails = useCallback(async () => {
    if (!userId || !firmId) {
      setError("User ID and Firm ID are required.");
      return;
    }
    
    // Clear any previous errors and messages
    setError(null);
    setMessage(null);
    
    try {
      setLoading(true);
      setError(null);
      console.log(`📡 Fetching LLM details for User: ${userId}, Firm: ${firmId}`);
      const url = `${apiBaseUrl}/get-llm-details?userid=${encodeURIComponent(userId)}&firmid=${encodeURIComponent(firmId)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      let response, data;
      try {
        response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("API endpoint not found. Please check server configuration.");
          } else if (response.status >= 500) {
            throw new Error("Server error. Please try again later.");
          }
          const errorJson = await response.json().catch(() => ({}));
          throw new Error(errorJson.error || `Failed to fetch provider data. Status: ${response.status}`);
        }
        data = await response.json();
      } catch (err) {
        if (err.name === 'AbortError') {
          setError("Request timed out. Please check your connection.");
          return;
        }
        setError(err.message || "Failed to fetch provider data.");
        return;
      }
      setLlmDetails(data || []);
      console.log(`✅ Found ${Array.isArray(data) ? data.length : 0} LLM provider records`);
    } catch (err) {
      console.error("❌ Error fetching LLM details:", err);
      setError(err.message || "Failed to fetch provider data.");
    } finally {
      setLoading(false);
    }
  }, [userId, firmId, apiBaseUrl]);

  useEffect(() => {
    fetchLLMDetails();
  }, [fetchLLMDetails]);

  const handleActivate = (provider, contextUserId, contextFirmId) => {
    const effectiveUserId = userId;
    const effectiveFirmId = firmId;
    
    console.log(`🔧 Activating provider: ${provider} for User: ${effectiveUserId}, Firm: ${effectiveFirmId}`);
    
    if (onProviderSelect) {
      onProviderSelect(provider, effectiveUserId, effectiveFirmId);
    }
    
    setMessage(`✅ Provider ${provider} activated successfully for User ${effectiveUserId}, Firm ${effectiveFirmId}!`);
    setTimeout(() => setMessage(null), 4000);
  };

  // note: removed unused validateInputs to satisfy no-unused-vars

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!apiKey || !selectedCategory || !llmProvider) {
      setError("All fields are required.");
      return;
    }
    
    // Validate the provider is valid for the selected category
    const selectedProvider = providersByCategory[selectedCategory]?.find(p => p.value === llmProvider);
    if (!selectedProvider) {
      setError("Invalid provider selected for this category.");
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    
    // Store the active provider for this user/firm
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROVIDER, JSON.stringify({
      userId: userId,
      firmId: firmId,
      provider: llmProvider,
      category: selectedCategory,
      timestamp: new Date().toISOString()
    }));

    // Validate required fields before submitting
    if (!userId || !firmId || !llmProvider || !selectedCategory || !apiKey.trim()) {
      setError("All fields are required: User, Firm, Provider, Category, and API Key.");
      setIsSubmitting(false);
      return;
    }
    const providerType = CATEGORY_DB_MAP[selectedCategory] || selectedCategory;
    if (!providerType) {
      setError("Invalid provider category selected.");
      setIsSubmitting(false);
      return;
    }
    try {
      console.log(`📝 Submitting API key for Category: ${selectedCategory}, Provider: ${llmProvider}, User: ${userId}, Firm: ${firmId}`);
      const payload = {
        userid: userId,
        firmid: firmId,
        LLM_PROVIDER_TYPE: providerType,
        LLM_PROVIDER: llmProvider,
        API_KEY: apiKey.trim(),
      };
      console.log('🔎 API Key POST payload:', payload);
      try {
        const response = await axios.post(`${apiBaseUrl}/add-api-key`, payload, {
          timeout: 15000
        });
        console.log("✅ API Key submission successful:", response.data);
        setMessage("✅ API Key added and activated successfully!");
        setError(null);
        setApiKey("");
        setLlmProvider("");
        // Refresh the table and activate the provider
      } catch (error) {
        console.error('❌ Error adding API key:', error?.response?.data || error);
        setError(error?.response?.data?.error || error.message);
      }
      await fetchLLMDetails();
      handleActivate(llmProvider, userId, firmId);

      setTimeout(() => setMessage(null), 4000);
      
    } catch (err) {
      console.error("❌ Error adding API key:", err);
      
      let errorMessage = "Failed to add API Key.";
      if (err.code === 'ECONNABORTED') {
        errorMessage = "Request timed out. Please try again.";
      } else if (err.response?.status === 400) {
        errorMessage = err.response.data?.message || "Invalid input data.";
      } else if (err.response?.status === 500) {
        errorMessage = "Server error. Please try again later.";
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      }
      
      setError(errorMessage);
      setMessage(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Firm/User IDs are fixed; no input handlers needed

  const clearError = () => setError(null);
  const clearMessage = () => setMessage(null);

  return (
    <div className="apikey-modal-overlay">
      <div className="apikey-modal-container">
        <div className="apikey-modal-header">
          <h2>🔧 AI Provider Configuration</h2>
          <button 
            className="apikey-modal-close" 
            onClick={onClose}
            aria-label="Close modal"
            disabled={isSubmitting}
          >
            ×
          </button>
        </div>

        {/* Status Messages */}
        {error && (
          <div style={{
            background: '#fef2f2',
            color: '#991b1b',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '16px',
            border: '1px solid #fecaca',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>❌ {error}</span>
            <button 
              onClick={clearError}
              style={{
                background: 'none',
                border: 'none',
                color: '#991b1b',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '0 4px'
              }}
            >
              ×
            </button>
          </div>
        )}
        
        {message && (
          <div style={{
            background: '#f0fdf4',
            color: '#166534',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '16px',
            border: '1px solid #bbf7d0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>{message}</span>
            <button 
              onClick={clearMessage}
              style={{
                background: 'none',
                border: 'none',
                color: '#166534',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '0 4px'
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Add API Key Form */}
        <form className="apikey-form" onSubmit={handleSubmit}>
          {/* Hidden username field for accessibility/autofill */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            style={{ display: 'none' }}
            tabIndex={-1}
          />

          <div>
            <label htmlFor="category">
              Category <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              id="category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              required
              disabled={isSubmitting}
              style={{
                padding: '12px 16px',
                border: '2px solid #e1e5e9',
                borderRadius: '8px',
                fontSize: '14px',
                width: '100%',
                marginBottom: '16px',
                backgroundColor: 'white'
              }}
            >
              <option value="">Select a category</option>
              <option value="IMAGE_GENERATION">🖼️ Image Generation</option>
              <option value="CAPTION_GENERATION">📝 Caption Generation</option>
              <option value="LANGUAGE_TEXT">💬 Language & Text</option>
              <option value="MUSIC_GENERATION">🎵 Music Generation</option>
              <option value="VOICE_SYNTHESIS">🎤 Voice & Speech</option>
              <option value="VIDEO_GENERATION">🎬 Video Generation</option>
            </select>

            <label htmlFor="llmProvider">
              LLM Provider <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              id="llmProvider"
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value)}
              required
              disabled={isSubmitting || !selectedCategory}
              style={{
                padding: '12px 16px',
                border: '2px solid #e1e5e9',
                borderRadius: '8px',
                fontSize: '14px',
                width: '100%',
                backgroundColor: 'white'
              }}
            >
              <option value="">Select LLM Provider</option>
              {selectedCategory && providersByCategory[selectedCategory]
                .filter(provider => {
                  // Filter by type based on category
                  if (selectedCategory === 'IMAGE_GENERATION') {
                    return provider.type === 'TEXT-TO-IMAGE';
                  } else if (selectedCategory === 'CAPTION_GENERATION') {
                    return provider.type === 'IMAGE-TO-TEXT';
                  } else if (selectedCategory === 'LANGUAGE_TEXT') {
                    return provider.type === 'TEXT-TO-TEXT';
                  } else if (selectedCategory === 'MUSIC_GENERATION') {
                    return provider.type === 'TEXT-TO-MUSIC';
                  } else if (selectedCategory === 'VOICE_SYNTHESIS') {
                    return provider.type === 'TEXT-TO-SPEECH';
                  } else if (selectedCategory === 'VIDEO_GENERATION') {
                    return provider.type === 'TEXT-TO-VIDEO';
                  }
                  return true;
                })
                .sort((a, b) => {
                  // First sort by tier (Premium > Freemium > Free)
                  const tierOrder = { 'Premium': 0, 'Freemium': 1, 'Free': 2, 'Pay-per-use': 0.5 };
                  const tierCompare = tierOrder[a.tier] - tierOrder[b.tier];
                  
                  // If same tier, sort by speed (Fast > Medium > Slow)
                  if (tierCompare === 0) {
                    const speedOrder = { 'Ultra Fast': 0, 'Fast': 1, 'Medium': 2, 'Slow': 3, 'Variable': 4 };
                    return speedOrder[a.speed] - speedOrder[b.speed];
                  }
                  
                  return tierCompare;
                })
                .map((provider) => {
                  // Add emoji and styling based on tier
                  const tierEmoji = {
                    'Premium': '⭐',
                    'Freemium': '🆓',
                    'Free': '🎯',
                    'Pay-per-use': '💳'
                  }[provider.tier] || '';
                  
                  const speedEmoji = {
                    'Ultra Fast': '⚡',
                    'Fast': '🚀',
                    'Medium': '🐢',
                    'Slow': '🐌',
                    'Variable': '🔄'
                  }[provider.speed] || '';
                  
                  return (
                    <option 
                      key={provider.value} 
                      value={provider.value}
                      title={`${provider.specialties} | ${provider.tier} | ${provider.speed}`}
                      style={{
                        fontWeight: provider.tier === 'Premium' ? '600' : 'normal',
                        color: provider.tier === 'Free' ? '#4b5563' : '#111827',
                        padding: '8px 12px',
                        borderBottom: '1px solid #f3f4f6'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ marginRight: '8px' }}>{tierEmoji}</span>
                          <strong>{provider.label}</strong>
                        </div>
                        <span style={{ fontSize: '0.9em', opacity: 0.8 }}>{speedEmoji}</span>
                      </div>
                      <div style={{ fontSize: '0.85em', margin: '4px 0', color: '#4b5563' }}>
                        {provider.description}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#6b7280', fontStyle: 'italic' }}>
                        Best for: {provider.specialties}
                      </div>
                    </option>
                  );
                })}
            </select>
          </div>

          <div>
            <label htmlFor="apiKey">
              API Key <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              id="apiKey"
              type="password"
              placeholder="Enter your API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              disabled={isSubmitting}
              autoComplete="new-password"
              style={{
                padding: '12px 16px',
                border: '2px solid #e1e5e9',
                borderRadius: '8px',
                fontSize: '14px',
                width: '100%'
              }}
            />
            <small style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginTop: '4px' }}>
              Your API key will be encrypted and stored securely
            </small>
          </div>

          <button 
            type="submit" 
            className="submit-button"
            disabled={isSubmitting || loading}
            style={{
              opacity: (isSubmitting || loading) ? 0.6 : 1,
              cursor: (isSubmitting || loading) ? 'not-allowed' : 'pointer'
            }}
          >
            {isSubmitting ? (
              <>
                <div style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid #ffffff40',
                  borderTop: '2px solid #ffffff',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginRight: '8px'
                }}></div>
                Adding API Key...
              </>
            ) : (
              "💾 Add/Update API Key"
            )}
          </button>
        </form>

        {/* Current Context Display */}
        <div style={{
          marginTop: '20px',
          padding: '15px',
          background: '#f0f9ff',
          borderRadius: '8px',
          fontSize: '14px',
          border: '1px solid #bae6fd'
        }}>
          <strong>🏢 Current Context:</strong> User ID: <code>{userId}</code>, Firm ID: <code>{firmId}</code>
          <br />
          <small style={{ color: '#0369a1', marginTop: '5px', display: 'block' }}>
            All providers will be managed for this User/Firm combination
          </small>
        </div>

        {/* LLM Details Table */}
        <div style={{ marginTop: '30px' }}>
          <h3 style={{ marginBottom: '15px', color: '#374151' }}>📋 Configured Providers</h3>
          
          {loading && !llmDetails.length ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#6b7280' }}>
              <div style={{
                width: '32px',
                height: '32px',
                border: '3px solid #e5e7eb',
                borderTop: '3px solid #3b82f6',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 15px'
              }}></div>
              <div style={{ fontWeight: '600', marginBottom: '5px' }}>Loading providers...</div>
              <div style={{ fontSize: '13px' }}>Fetching data for User {userId}, Firm {firmId}</div>
            </div>
          ) : (
            <LLMDetailsTable
              onActivate={handleActivate}
              fetchLLMDetails={fetchLLMDetails}
              llmDetails={llmDetails}
              userId={userId}
              firmId={firmId}
            />
          )}
        </div>

        {/* Instructions */}
        <div style={{
          marginTop: '25px',
          padding: '20px',
          background: '#f9fafb',
          borderRadius: '8px',
          fontSize: '14px',
          color: '#374151',
          border: '1px solid #e5e7eb'
        }}>
          <strong>💡 Instructions:</strong>
          <ul style={{ margin: '10px 0 0 0', paddingLeft: '20px', lineHeight: '1.6' }}>
            <li>Select your preferred AI provider and enter your API key</li>
            <li>Only one provider can be active at a time per User/Firm combination</li>
            <li>The system will use your active provider for generating business reports</li>
            <li>If your provider fails, the system will automatically fallback to Groq</li>
            <li>Different User/Firm combinations can have different active providers</li>
          </ul>
        </div>

        {/* Animation styles */}
        <style jsx="true">{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
};

export default ApiKeyManager;
