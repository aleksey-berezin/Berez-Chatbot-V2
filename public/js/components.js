// Reusable UI Components for Chat Interface
class ChatComponents {
  // Message component
  static createMessage(content, isUser = false, timestamp = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = this.formatMessage(content);
    
    messageDiv.appendChild(contentDiv);
    
    if (timestamp) {
      const timeDiv = document.createElement('div');
      timeDiv.className = 'message-time';
      timeDiv.textContent = timestamp;
      messageDiv.appendChild(timeDiv);
    }
    
    return messageDiv;
  }

  // Typing indicator component
  static createTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot-message typing-indicator';
    typingDiv.innerHTML = `
      <div class="message-content">
        <div class="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;
    return typingDiv;
  }

  // Input component
  static createInput(onSubmit, placeholder = 'Type your message...') {
    const inputContainer = document.createElement('div');
    inputContainer.className = 'input-container';
    
    const input = document.createElement('textarea');
    input.className = 'message-input';
    input.placeholder = placeholder;
    input.rows = 1;
    
    const sendButton = document.createElement('button');
    sendButton.className = 'send-button';
    sendButton.innerHTML = '➤';
    sendButton.disabled = true;
    
    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      sendButton.disabled = !input.value.trim();
    });
    
    // Handle submit
    const handleSubmit = () => {
      const message = input.value.trim();
      if (message) {
        onSubmit(message);
        input.value = '';
        input.style.height = 'auto';
        sendButton.disabled = true;
      }
    };
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    });
    
    sendButton.addEventListener('click', handleSubmit);
    
    inputContainer.appendChild(input);
    inputContainer.appendChild(sendButton);
    
    return inputContainer;
  }

  // Error component
  static createError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `
      <div class="error-content">
        <span class="error-icon">⚠️</span>
        <span class="error-text">${message}</span>
      </div>
    `;
    return errorDiv;
  }

  // Success component
  static createSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.innerHTML = `
      <div class="success-content">
        <span class="success-icon">✅</span>
        <span class="success-text">${message}</span>
      </div>
    `;
    return successDiv;
  }

  // Loading component
  static createLoading(message = 'Loading...') {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-message';
    loadingDiv.innerHTML = `
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <span class="loading-text">${message}</span>
      </div>
    `;
    return loadingDiv;
  }

  // Format message content (convert markdown-like syntax to HTML)
  static formatMessage(content) {
    return content
      // Convert **bold** to <strong>
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Convert *italic* to <em>
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Convert line breaks to <br>
      .replace(/\n/g, '<br>')
      // Convert links [text](url) to <a>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // Convert bullet points
      .replace(/^•\s*(.*)$/gm, '<li>$1</li>')
      // Wrap lists in <ul>
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  }

  // Scroll to bottom utility
  static scrollToBottom(container) {
    container.scrollTop = container.scrollHeight;
  }

  // Fade in animation
  static fadeIn(element, duration = 300) {
    element.style.opacity = '0';
    element.style.transition = `opacity ${duration}ms ease-in-out`;
    
    setTimeout(() => {
      element.style.opacity = '1';
    }, 10);
  }

  // Remove element with fade out
  static fadeOut(element, duration = 300) {
    element.style.transition = `opacity ${duration}ms ease-in-out`;
    element.style.opacity = '0';
    
    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }, duration);
  }
}

// Export for use in chat interface
window.ChatComponents = ChatComponents; 