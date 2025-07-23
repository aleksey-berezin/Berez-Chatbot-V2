// Shared API client for consistent frontend-backend communication
class ApiClient {
    constructor() {
        this.baseUrl = window.location.origin;
        this.sessionId = null;
    }

    async getHealth() {
        try {
            const response = await fetch(`${this.baseUrl}/api/health`);
            if (!response.ok) {
                throw new Error(`Health check failed: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Health check error:', error);
            return { status: 'unhealthy', error: error.message };
        }
    }

    async sendMessage(message, sessionId = null) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId || this.sessionId
            };

            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ message })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            // Update session ID if provided
            if (result.sessionId) {
                this.sessionId = result.sessionId;
            }

            return result;
        } catch (error) {
            console.error('Send message error:', error);
            throw error;
        }
    }

    async sendMessageStream(message, sessionId = null, onChunk = null) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId || this.sessionId
            };

            const response = await fetch(`${this.baseUrl}/api/chat/stream`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ message })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Update session ID from response headers
            const responseSessionId = response.headers.get('X-Session-ID');
            if (responseSessionId) {
                this.sessionId = responseSessionId;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                
                // Send each chunk directly to the callback
                if (chunk && onChunk) {
                    onChunk(chunk);
                }
            }

        } catch (error) {
            console.error('Streaming error:', error);
            throw error;
        }
    }

    async getSession(sessionId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/session/${sessionId}`);
            if (!response.ok) {
                throw new Error(`Session not found: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Get session error:', error);
            throw error;
        }
    }

    async deleteSession(sessionId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/session/${sessionId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to delete session: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Delete session error:', error);
            throw error;
        }
    }

    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }

    getSessionId() {
        return this.sessionId;
    }
}

// Export for use in components
window.ApiClient = ApiClient; 