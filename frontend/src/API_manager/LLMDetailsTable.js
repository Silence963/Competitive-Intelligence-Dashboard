// components/LLMDetailsTable.js
import React, { useState, useMemo } from "react";
import axios from "axios";

// Map of provider types to their display names
const providerTypeLabels = {
  IMAGE_GENERATION: "🖼️ Image Gen",
  CAPTION_GENERATION: "📝 Caption Gen",
  LANGUAGE_TEXT: "💬 Language",
  MUSIC_GENERATION: "🎵 Music",
  VOICE_SYNTHESIS: "🔊 Voice",
  VIDEO_GENERATION: "🎬 Video"
};

// Color mapping for provider types
const typeColors = {
  IMAGE_GENERATION: '#8b5cf6',
  CAPTION_GENERATION: '#3b82f6',
  LANGUAGE_TEXT: '#10b981'
};

// Provider icons mapping
const providerIcons = {
  // Image Generation
  'OPENAI_DALLE3': '🎨', 'MIDJOURNEY': '🌌', 'ADOBE_FIREFLY': '🔥',
  'STABILITY_AI': '🌊', 'LEONARDO_AI': '🦁', 'FLUX_AI': '⚡',
  'IDEOGRAM': '✏️', 'STABLE_DIFFUSION': '🎭', 'DREAMSTUDIO': '🌠',
  'RUNWAY_ML': '🎥', 'TOGETHER_STABLE_DIFFUSION': '🤝', 'KANDINSKY': '🖌️',
  
  // Caption Generation
  'OPENAI_GPT4V': '👁️', 'CLAUDE_VISION': '🔍', 'GEMINI_VISION': '🔮',
  'QWEN_VL': '👁️', 'COGVLM': '🤖', 'PALIGEMMA': '🦜',
  'LLAVA': '🦉', 'MINIGPT4': '📱', 'INSTRUCTBLIP': '📝', 'PHI3_VISION': 'φ',
  'GEMINI_PRO_VISION': '👁️', 'CLAUDE_3_OPUS': '🤖', 'LLAVA_13B': '🦉',
  
  // Language & Text
  'PLAYHT': '🎙️', 'GROQ': '⚡', 'OPENROUTER': '🔄', 'CLAUDE': '🤖',
  'OPENAI_GPT4': '🧠', 'GEMINI': '✨', 'GEMINI_PRO': '✨', 'GEMINI_FLASH': '⚡',
  'MISTRAL': '🌪️', 'DEEPSEEK': '🔍', 'OLLAMA': '🦙', 'COHERE': '🔤',
  'TOGETHER_AI': '🔄', 'REPLICATE': '🔄',
  
  // Music Generation
  'SUNO_AI': '🎵', 'UDIO': '🎼', 'MUSICGEN_META': '🎹',
  'AIVA': '🎻', 'MUBERT': '🎧', 'SOUNDRAW': '🎶',
  
  // Video Generation
  'RUNWAY_GEN4': '🎬', 'OPENAI_SORA': '🎥', 'GOOGLE_VEO2': '📹',
  'PIKA_2_2': '📽️', 'KLING_AI_2': '🎞️', 'HAILUO_AI': '📺', 'WAN2_2': '📼'
};

// Map DB codes to UI categories (module scope so hooks don't depend on it)
const TYPE_CODE_TO_UI = {
  // Standardized type mappings
  'LANGUAGE_TEXT': 'LANGUAGE_TEXT',
  'TEXT-TO-TEXT': 'LANGUAGE_TEXT',
  'TEXT': 'LANGUAGE_TEXT',
  'LANG': 'LANGUAGE_TEXT',
  'L': 'LANGUAGE_TEXT',
  
  'IMAGE_GENERATION': 'IMAGE_GENERATION',
  'TEXT-TO-IMAGE': 'IMAGE_GENERATION',
  'IMAGE': 'IMAGE_GENERATION',
  'IMG': 'IMAGE_GENERATION',
  'I': 'IMAGE_GENERATION',
  
  'CAPTION_GENERATION': 'CAPTION_GENERATION',
  'IMAGE-TO-TEXT': 'CAPTION_GENERATION',
  'CAPTION': 'CAPTION_GENERATION',
  'CAP': 'CAPTION_GENERATION',
  'C': 'CAPTION_GENERATION',
  
  'MUSIC_GENERATION': 'MUSIC_GENERATION',
  'TEXT-TO-MUSIC': 'MUSIC_GENERATION',
  'MUSIC': 'MUSIC_GENERATION',
  'MUS': 'MUSIC_GENERATION',
  'M': 'MUSIC_GENERATION',
  
  'VOICE_SYNTHESIS': 'VOICE_SYNTHESIS',
  'TEXT-TO-SPEECH': 'VOICE_SYNTHESIS',
  'VOICE': 'VOICE_SYNTHESIS',
  'TTS': 'VOICE_SYNTHESIS',
  'T': 'VOICE_SYNTHESIS',
  
  'VIDEO_GENERATION': 'VIDEO_GENERATION',
  'TEXT-TO-VIDEO': 'VIDEO_GENERATION',
  'VIDEO': 'VIDEO_GENERATION',
  'VID': 'VIDEO_GENERATION',
  'V': 'VIDEO_GENERATION'
};

const LLMDetailsTable = ({ 
  onActivate, 
  fetchLLMDetails, 
  llmDetails = [], 
  userId: propUserId = "", 
  firmId: propFirmId = "",
  categoryLabels = {},
  apiBaseUrl = "http://localhost:5600/api"
}) => {
  // Resolve tenant IDs from props or URL
  const urlParams = new URLSearchParams(window.location.search);
  const userId = propUserId || urlParams.get('userid') || '';
  const firmId = propFirmId || urlParams.get('firmid') || '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [processingId, setProcessingId] = useState(null);

  const toggleStatus = async (id, provider, providerType, currentStatus) => {
    setLoading(true);
    setProcessingId(id);
    setError("");
    
    try {
      console.log(`🔄 Toggling status for ID: ${id}, Provider: ${provider} (${providerType}), User: ${userId}, Firm: ${firmId}`);
      
      const action = currentStatus === 'ACTIVE' ? 'DEACTIVATE' : 'ACTIVATE';
      const response = await axios.post(`${apiBaseUrl}/toggle-status?userid=${encodeURIComponent(userId)}&firmid=${encodeURIComponent(firmId)}`, {
        id,
        userid: userId,
        firmid: firmId,
        provider_type: providerType,
        action
      });

      if (response.data.success) {
        console.log(`✅ Status toggled successfully to: ${response.data.newStatus}`);
        await fetchLLMDetails(); // Refresh the table
        
        // If provider was activated, notify parent with user context and type
        if (response.data.newStatus === 'ACTIVE') {
          onActivate(provider, providerType, userId, firmId);
        }
        
        // Show success message
        setError("");
      } else {
        throw new Error(response.data.error || 'Failed to update status');
      }
    } catch (err) {
      console.error("❌ Error toggling status:", err);
      
      // Handle different types of errors
      if (err.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error("Response data:", err.response.data);
        console.error("Response status:", err.response.status);
        console.error("Response headers:", err.response.headers);
        
        setError(`Error: ${err.response.data?.error || err.response.statusText || 'Unknown error'}`);
      } else if (err.request) {
        // The request was made but no response was received
        console.error("No response received:", err.request);
        setError("No response from server. Please check your connection.");
      } else {
        // Something happened in setting up the request that triggered an Error
        console.error('Error:', err.message);
        setError(`Error: ${err.message}`);
      }
    } finally {
      setLoading(false);
      setProcessingId(null);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return 'Invalid Date';
    }
  };

  const maskApiKey = (apiKey) => {
    if (!apiKey) return 'N/A';
    if (apiKey.length <= 8) return '*'.repeat(Math.min(apiKey.length, 6));
    return apiKey.substring(0, 3) + '***' + apiKey.substring(apiKey.length - 2);
  };

  // Get provider type display name with fallback
  const getProviderTypeLabel = (rawType) => {
    const uiType = TYPE_CODE_TO_UI[rawType] || rawType;
    return providerTypeLabels[uiType] || uiType || 'Unknown';
  };

  // Get provider icon with fallback
  const getProviderIcon = (provider) => {
    return providerIcons[provider] || '🔧';
  };

  // Group providers by type (normalize DB codes to UI categories for display)
  const groupedProviders = useMemo(() => {
    const groups = {};
    
    llmDetails.forEach(item => {
      const rawType = item.LLM_PROVIDER_TYPE || 'UNKNOWN';
      const uiType = TYPE_CODE_TO_UI[rawType] || rawType;
      if (!groups[uiType]) {
        groups[uiType] = [];
      }
      groups[uiType].push(item);
    });
    
    // Sort groups by type
    return Object.entries(groups)
      .sort(([typeA], [typeB]) => {
        const order = ['IMAGE_GENERATION', 'CAPTION_GENERATION', 'LANGUAGE_TEXT'];
        return order.indexOf(typeA) - order.indexOf(typeB);
      });
  }, [llmDetails]);

  if (error) {
    return (
      <div style={{
        background: '#fee',
        color: '#c33',
        padding: '15px',
        borderRadius: '8px',
        textAlign: 'center',
        border: '1px solid #fcc',
        marginBottom: '20px'
      }}>
        ❌ {error}
        <button
          onClick={() => setError("")}
          style={{
            marginLeft: '10px',
            background: 'none',
            border: 'none',
            color: '#c33',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          ×
        </button>
      </div>
    );
  }

  const tableHeaderStyle = {
    padding: '14px 20px',
    textAlign: 'left',
    fontWeight: '600',
    fontSize: '13px',
    color: '#475569',
    borderBottom: '2px solid #e2e8f0',
    background: 'linear-gradient(to bottom, #f8fafc, #f1f5f9)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  };

  const tableCellStyle = {
    padding: '16px 20px',
    fontSize: '14px',
    color: '#334155',
    borderBottom: '1px solid #f1f5f9',
    verticalAlign: 'middle'
  };

  // Status badge component
  const StatusBadge = ({ status }) => (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 12px',
      borderRadius: '16px',
      fontSize: '12px',
      fontWeight: '600',
      backgroundColor: status === 'ACTIVE' ? '#dcfce7' : '#f1f5f9',
      color: status === 'ACTIVE' ? '#15803d' : '#64748b',
      border: `1.5px solid ${status === 'ACTIVE' ? '#86efac' : '#cbd5e1'}`,
      textTransform: 'uppercase',
      letterSpacing: '0.3px'
    }}>
      <span style={{ fontSize: '10px' }}>{status === 'ACTIVE' ? '●' : '○'}</span>
      {status === 'ACTIVE' ? 'Active' : 'Inactive'}
    </span>
  );

  // Type badge component
  const TypeBadge = ({ type }) => (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '6px 12px',
      borderRadius: '8px',
      fontSize: '12px',
      fontWeight: '600',
      backgroundColor: `${typeColors[type] || '#e2e8f0'}`,
      color: 'white',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      {getProviderTypeLabel(type)}
    </span>
  );

  // Provider cell component
  const ProviderCell = ({ provider }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span style={{
        fontSize: '22px',
        width: '32px',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)'
      }}>
        {getProviderIcon(provider)}
      </span>
      <span style={{ fontWeight: '600', fontSize: '14px', color: '#1e293b' }}>{provider}</span>
    </div>
  );

  return (
    <div>
      {/* User Context Display */}
      <div style={{
        marginBottom: '15px',
        padding: '10px 15px',
        background: '#f0f9ff',
        borderRadius: '6px',
        fontSize: '13px',
        color: '#0369a1',
        border: '1px solid #bae6fd',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <span>🔍</span>
        <span><strong>Viewing providers for:</strong> User ID: <code>{userId || 'Not set'}</code>, Firm ID: <code>{firmId || 'Not set'}</code></span>
      </div>

      {groupedProviders.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          background: '#f9fafb',
          borderRadius: '8px',
          border: '1px dashed #e5e7eb',
          color: '#6b7280'
        }}>
          <div style={{ fontSize: '24px', marginBottom: '10px' }}>📭</div>
          <h3 style={{ marginBottom: '8px', color: '#374151' }}>No API Keys Found</h3>
          <p style={{ margin: 0, color: '#6b7280' }}>
            Add an API key to get started with {!userId || !firmId ? 'your selected User/Firm' : 'this account'}.
          </p>
        </div>
      ) : (
        groupedProviders.map(([type, providers]) => (
          <div key={type} style={{ marginBottom: '24px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '12px',
              paddingBottom: '8px',
              borderBottom: `2px solid ${typeColors[type] || '#e5e7eb'}`
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '15px',
                fontWeight: '600',
                color: typeColors[type] || '#374151',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <TypeBadge type={type} />
                <span>{categoryLabels[type] || getProviderTypeLabel(type)}</span>
              </h3>
              <span style={{
                marginLeft: '8px',
                fontSize: '12px',
                color: '#6b7280',
                backgroundColor: '#f3f4f6',
                padding: '2px 8px',
                borderRadius: '10px'
              }}>
                {providers.length} {providers.length === 1 ? 'provider' : 'providers'}
              </span>
            </div>
            
            {/* Table Container */}
            <div style={{ 
              overflowX: 'auto',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              border: '1px solid #e5e7eb',
              marginBottom: '24px'
            }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                background: 'white',
                fontSize: '14px'
              }}>
                <thead>
                  <tr>
                    <th style={{ ...tableHeaderStyle, width: '30%' }}>Provider</th>
                    <th style={{ ...tableHeaderStyle, width: '20%' }}>Type</th>
                    <th style={{ ...tableHeaderStyle, width: '15%' }}>API Key</th>
                    <th style={{ ...tableHeaderStyle, width: '15%' }}>Updated</th>
                    <th style={{ ...tableHeaderStyle, width: '10%' }}>Status</th>
                    <th style={{ ...tableHeaderStyle, width: '10%' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((item, index) => {
                    const isActive = item.STATUS === 'ACTIVE';
                    const isProcessing = processingId === item.ID;
                    const providerType = item.LLM_PROVIDER_TYPE || type;
                    const isLastItem = index === providers.length - 1;
                    
                    return (
                      <tr 
                        key={item.ID}
                        style={{
                          backgroundColor: isActive ? '#f8fafc' : 'transparent',
                          transition: 'background-color 0.2s',
                          borderBottom: isLastItem ? 'none' : '1px solid #f1f5f9',
                          height: '48px'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.backgroundColor = isActive ? '#f0fdf9' : '#f8fafc';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.backgroundColor = isActive ? '#f8fafc' : 'transparent';
                        }}
                      >
                        <td style={tableCellStyle}>
                          <ProviderCell provider={item.LLM_PROVIDER} />
                        </td>
                        <td style={tableCellStyle}>
                          <TypeBadge type={providerType} />
                        </td>
                        <td style={tableCellStyle}>
                          <div style={{
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            color: '#6b7280',
                            wordBreak: 'break-all',
                            backgroundColor: '#f8fafc',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid #e2e8f0'
                          }}>
                            {maskApiKey(item.API_KEY)}
                          </div>
                        </td>
                        <td style={tableCellStyle}>
                          <div style={{
                            fontSize: '12px',
                            color: '#64748b',
                            whiteSpace: 'nowrap'
                          }}>
                            {formatDate(item.UPDATED_AT || item.CREATED_AT)}
                          </div>
                        </td>
                        <td style={tableCellStyle}>
                          <StatusBadge status={item.STATUS} />
                        </td>
                        <td style={{ ...tableCellStyle, textAlign: 'center' }}>
                          <button
                            onClick={() => toggleStatus(item.ID, item.LLM_PROVIDER, providerType, item.STATUS)}
                            disabled={loading}
                            style={{
                              padding: '8px 16px',
                              borderRadius: '8px',
                              border: 'none',
                              background: isActive ? 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                              color: isActive ? '#475569' : 'white',
                              fontWeight: '600',
                              fontSize: '13px',
                              cursor: loading ? 'not-allowed' : 'pointer',
                              opacity: (loading && processingId === item.ID) ? 0.7 : 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              transition: 'all 0.2s',
                              minWidth: '100px',
                              justifyContent: 'center',
                              boxShadow: isActive ? 'none' : '0 2px 4px rgba(102, 126, 234, 0.3)',
                              transform: 'translateY(0)'
                            }}
                            onMouseEnter={(e) => {
                              if (!loading) {
                                e.target.style.transform = 'translateY(-2px)';
                                e.target.style.boxShadow = isActive ? '0 2px 4px rgba(0,0,0,0.1)' : '0 4px 8px rgba(102, 126, 234, 0.4)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!loading) {
                                e.target.style.transform = 'translateY(0)';
                                e.target.style.boxShadow = isActive ? 'none' : '0 2px 4px rgba(102, 126, 234, 0.3)';
                              }
                            }}
                          >
                            {isProcessing ? (
                              <>
                                <div style={{
                                  width: '12px',
                                  height: '12px',
                                  border: '2px solid #ffffff40',
                                  borderTop: '2px solid #ffffff',
                                  borderRadius: '50%',
                                  animation: 'spin 1s linear infinite',
                                  marginRight: '4px'
                                }}></div>
                                {isActive ? 'Deactivating' : 'Activating'}
                              </>
                            ) : isActive ? (
                              'Deactivate'
                            ) : (
                              'Activate'
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default LLMDetailsTable;
