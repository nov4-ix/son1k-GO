import React, { useState, useEffect } from 'react';
import { User, Repository, AIConfig, AIProvider, DeploymentConfig, ChatMessage } from './types';
import { api } from './services/api';

import Header from './components/Header';
import LoginScreen from './components/LoginScreen';
import RepoSelector from './components/RepoSelector';
import CodeAssistant from './components/CodeAssistant';
import DeployConfig from './components/DeployConfig';
import DeployFinalize from './components/DeployFinalize';
import Spinner from './components/Spinner';
import AIConfigModal from './components/AIConfigModal';

type AppView = 'LOGIN' | 'REPO_SELECTOR' | 'CODE_ASSISTANT' | 'DEPLOY_CONFIG' | 'DEPLOY_FINALIZE';

const DEFAULT_AI_CONFIG: AIConfig = {
    provider: AIProvider.GEMINI,
    apiKey: '',
    model: 'gemini-2.5-flash',
    baseUrl: '',
};

const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [deploymentConfig, setDeploymentConfig] = useState<DeploymentConfig | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);


  const [currentView, setCurrentView] = useState<AppView>('LOGIN');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [aiConfig, setAiConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [isAiConfigModalOpen, setIsAiConfigModalOpen] = useState(false);

  useEffect(() => {
      try {
          const savedConfig = localStorage.getItem('ai_config');
          if (savedConfig) {
              setAiConfig(JSON.parse(savedConfig));
          }
      } catch (e) {
          console.error("Failed to parse AI config from localStorage", e);
      }
  }, []);

  // Save chat history to session storage whenever it changes for the selected repo.
  useEffect(() => {
    if (selectedRepo) {
      // Avoid clearing session storage on initial empty state before anything is loaded
      if (chatHistory.length > 0) {
        sessionStorage.setItem(`chatHistory_${selectedRepo.id}`, JSON.stringify(chatHistory));
      } else {
        // If chat history is cleared, remove it from storage.
        sessionStorage.removeItem(`chatHistory_${selectedRepo.id}`);
      }
    }
  }, [chatHistory, selectedRepo]);

  const handleAiConfigChange = (newConfig: AIConfig) => {
      setAiConfig(newConfig);
      localStorage.setItem('ai_config', JSON.stringify(newConfig));
  };


  const loadInitialData = async (githubToken: string) => {
      setIsLoading(true);
      setError(null);
      
      try {
        const userData = await api.connectWithGithub(githubToken);
        setUser(userData);
        
        const repoData = await api.fetchRepositories(githubToken);
        setRepos(repoData);
        setCurrentView('REPO_SELECTOR');

      } catch (err) {
          console.error("Login failed:", err);
          setError("Error al conectar con GitHub. Tu token podría ser inválido o haber expirado.");
          sessionStorage.removeItem('github_token');
          localStorage.removeItem('github_token');
          setToken(null);
          setUser(null);
          setCurrentView('LOGIN');
      } finally {
          setIsLoading(false);
      }
  };

  useEffect(() => {
    const savedToken = localStorage.getItem('github_token') || sessionStorage.getItem('github_token');
    if (savedToken) {
        setToken(savedToken);
        loadInitialData(savedToken);
    } else {
        setIsLoading(false);
    }
  }, []);


  const handleLogin = async (newToken: string, remember: boolean) => {
    setIsLoading(true);
    if (remember) {
        localStorage.setItem('github_token', newToken);
    } else {
        sessionStorage.setItem('github_token', newToken);
    }
    setToken(newToken);
    
    setError(null);
    try {
        const userData = await api.connectWithGithub(newToken);
        setUser(userData);
        const repoData = await api.fetchRepositories(newToken);
        setRepos(repoData);
        setCurrentView('REPO_SELECTOR');
    } catch (err) {
        console.error("Login failed:", err);
        setError("Error al conectar con GitHub. Tu token podría ser inválido o haber expirado.");
        sessionStorage.removeItem('github_token');
        localStorage.removeItem('github_token');
        setToken(null);
        setUser(null);
        setCurrentView('LOGIN');
    } finally {
        setIsLoading(false);
    }
  };
  
  const handleLogout = () => {
      sessionStorage.removeItem('github_token');
      localStorage.removeItem('github_token');
      setToken(null);
      setUser(null);
      setSelectedRepo(null);
      setRepos([]);
      setCurrentView('LOGIN');
  };

  const handleSelectRepo = (repo: Repository) => {
    try {
        const savedHistory = sessionStorage.getItem(`chatHistory_${repo.id}`);
        setChatHistory(savedHistory ? JSON.parse(savedHistory) : []);
    } catch (e) {
        console.error("Failed to load chat history:", e);
        setChatHistory([]);
    }
    setSelectedRepo(repo);
    setCurrentView('CODE_ASSISTANT');
  };
  
  const handleDeployClick = (repo: Repository) => {
      setSelectedRepo(repo);
      setCurrentView('DEPLOY_CONFIG');
  }

  const handleProceedToFinalize = (config: DeploymentConfig) => {
    setDeploymentConfig(config);
    setCurrentView('DEPLOY_FINALIZE');
  };

  const handleRefreshRepos = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
        const repoData = await api.fetchRepositories(token);
        setRepos(repoData);
    } catch (err) {
        console.error("Failed to refresh repositories:", err);
    } finally {
        setIsLoading(false);
    }
  };

  const handleRefreshFileTree = async (repoToUpdate: Repository) => {
    if (!token) return;
    try {
        const updatedRepo = await api.fetchSingleRepository(token, repoToUpdate.owner.login, repoToUpdate.name);
        setSelectedRepo(updatedRepo); // Update the selected repo in state
        setRepos(prev => prev.map(r => r.id === updatedRepo.id ? updatedRepo : r)); // Update the repo in the main list
    } catch (err) {
        console.error("Failed to refresh file tree:", err);
        setError("Could not refresh the file tree.");
    }
  };


  const renderContent = () => {
    if (isLoading) {
      return <div className="flex items-center justify-center min-h-[calc(100vh-200px)]"><Spinner size="lg" /></div>;
    }

    switch (currentView) {
      case 'LOGIN':
        return <LoginScreen onLogin={handleLogin} loading={isLoading} error={error} />;
      case 'REPO_SELECTOR':
        return <RepoSelector repos={repos} onSelectRepo={handleSelectRepo} token={token} onRefreshRepos={handleRefreshRepos} />;
      case 'CODE_ASSISTANT':
        return selectedRepo && token ? <CodeAssistant repo={selectedRepo} token={token} aiConfig={aiConfig} chatHistory={chatHistory} setChatHistory={setChatHistory} onFileTreeUpdate={() => handleRefreshFileTree(selectedRepo)} onDeployClick={handleDeployClick} onBackToRepos={() => setCurrentView('REPO_SELECTOR')} /> : null;
      case 'DEPLOY_CONFIG':
        return selectedRepo ? <DeployConfig repo={selectedRepo} onProceed={handleProceedToFinalize} onBack={() => setCurrentView('CODE_ASSISTANT')} /> : null;
      case 'DEPLOY_FINALIZE':
        return deploymentConfig && token ? <DeployFinalize token={token} config={deploymentConfig} onBack={() => setCurrentView('DEPLOY_CONFIG')} onComplete={() => setCurrentView('REPO_SELECTOR')} /> : null;
      default:
        return <LoginScreen onLogin={handleLogin} loading={isLoading} error={error} />;
    }
  };

  return (
    <div className="bg-[#1C232E] text-white min-h-screen font-sans">
      <Header user={user} onLogout={handleLogout} onOpenAiConfig={() => setIsAiConfigModalOpen(true)}/>
      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        {renderContent()}
      </main>
      <AIConfigModal 
        isOpen={isAiConfigModalOpen}
        onClose={() => setIsAiConfigModalOpen(false)}
        config={aiConfig}
        onConfigChange={handleAiConfigChange}
      />
    </div>
  );
};

export default App;