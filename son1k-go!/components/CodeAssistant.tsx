import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import hljs from 'highlight.js';
import { Repository, AIConfig, ChatMessage, AIProvider, OpenFile } from '../types';
import { api } from '../services/api';
import * as aiService from '../services/ai';
import FileTree from './FileTree';
import DiffViewer from './DiffViewer';
import Spinner from './Spinner';
import Button from './Button';
import { SparklesIcon } from './icons/SparklesIcon';
import { BackArrowIcon } from './icons/BackArrowIcon';
import { UserIcon } from './icons/UserIcon';
import { CloseIcon } from './icons/CloseIcon';

interface CodeAssistantProps {
  repo: Repository;
  token: string;
  aiConfig: AIConfig;
  chatHistory: ChatMessage[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onFileTreeUpdate: () => void;
  onDeployClick: (repo: Repository) => void;
  onBackToRepos: () => void;
}

const CodeAssistant: React.FC<CodeAssistantProps> = ({ repo, token, aiConfig, chatHistory, setChatHistory, onFileTreeUpdate, onDeployClick, onBackToRepos }) => {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  const activeFile = useMemo(() => openFiles.find(f => f.path === activeFilePath), [openFiles, activeFilePath]);

  const fileTreeString = useMemo(() => {
    return repo.fileTree.map(f => f.path).join('\n');
  }, [repo.fileTree]);

  // Auto-scroll chat to bottom
  useEffect(() => {
      if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
  }, [chatHistory]);

  const handleFileSelect = useCallback(async (path: string) => {
    if (openFiles.some(f => f.path === path)) {
        setActiveFilePath(path);
        return;
    }

    setIsLoadingFile(true);
    setError(null);
    try {
      const { content, sha } = await api.getFileContent(token, repo.owner.login, repo.name, path);
      const newFile: OpenFile = { path, content, sha };
      setOpenFiles(prev => [...prev, newFile]);
      setActiveFilePath(path);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : `Could not load file: ${path}.`;
      console.error("Failed to fetch file content:", err);
      setError(errorMessage);
    } finally {
      setIsLoadingFile(false);
    }
  }, [token, repo.owner.login, repo.name, openFiles]);

  const handleCloseTab = (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      const fileIndex = openFiles.findIndex(f => f.path === path);
      const newOpenFiles = openFiles.filter(f => f.path !== path);
      setOpenFiles(newOpenFiles);

      if (activeFilePath === path) {
          if (newOpenFiles.length === 0) {
              setActiveFilePath(null);
          } else {
              const newIndex = Math.max(0, fileIndex - 1);
              setActiveFilePath(newOpenFiles[newIndex].path);
          }
      }
  };
  
  // Auto-open README on repo load
  useEffect(() => {
    const readme = repo.fileTree.find(f => f.path.toLowerCase() === 'readme.md');
    if (readme) {
        handleFileSelect(readme.path);
    }
  }, [repo.fileTree, handleFileSelect]);

  const handleGenerateClick = async () => {
    if (!prompt.trim() || !activeFile) return;
    
    setIsGenerating(true);
    abortControllerRef.current = new AbortController();

    const userMessage: ChatMessage = { id: `user_${Date.now()}`, role: 'user', content: `Regarding \`${activeFile.path}\`: ${prompt}` };
    const aiMessageId = `model_${Date.now()}`;
    const aiThinkingMessage: ChatMessage = { id: aiMessageId, role: 'model', content: '', isLoading: true };

    setChatHistory(prev => [...prev, userMessage, aiThinkingMessage]);
    setPrompt('');

    try {
      const suggestion = await aiService.generateCodeSuggestion({
          config: aiConfig,
          fileContent: activeFile.content,
          userInstruction: prompt,
          fileName: activeFile.path,
          fullFileTree: fileTreeString,
          signal: abortControllerRef.current.signal,
      });

      const updatedAiMessage: ChatMessage = {
          ...aiThinkingMessage,
          isLoading: false,
          content: `He generado una sugerencia de código para \`${activeFile.path}\`. Revisa los cambios a continuación.`,
          suggestion,
          fileContent: activeFile.content,
      };
      
      setChatHistory(prev => prev.map(m => m.id === aiMessageId ? updatedAiMessage : m));

    } catch (err) {
       const errorMessage = err instanceof Error ? err.message : "Failed to get suggestion from AI.";
       if ((err as Error).name !== 'AbortError') {
         console.error("AI suggestion failed:", err);
         const errorAiMessage: ChatMessage = {
             ...aiThinkingMessage,
             isLoading: false,
             content: `Lo siento, ocurrió un error: ${errorMessage}`,
             error: errorMessage,
         };
         setChatHistory(prev => prev.map(m => m.id === aiMessageId ? errorAiMessage : m));
       } else {
           setChatHistory(prev => prev.filter(m => m.id !== aiMessageId));
       }
    } finally {
        setIsGenerating(false);
    }
  };

  const handleStopGeneration = () => {
      if(abortControllerRef.current) {
          abortControllerRef.current.abort();
      }
  }
  
  const handleAcceptChanges = async (message: ChatMessage) => {
      if (!message.suggestion || !activeFile) return;
      setIsCommitting(true);

      try {
          const userPromptForCommit = chatHistory.find(m => m.role === 'user' && m.id < message.id);
          const commitMessage = `Asistente IA: ${userPromptForCommit?.content.substring(0, 100) || `actualiza ${activeFile.path}`}`;
          const { newSha } = await api.updateFileContent(token, repo.owner.login, repo.name, activeFile.path, message.suggestion, activeFile.sha, commitMessage);
          
          const updatedFile: OpenFile = { ...activeFile, content: message.suggestion, sha: newSha };
          setOpenFiles(prev => prev.map(f => f.path === activeFile.path ? updatedFile : f));
          
          const successMessage: ChatMessage = { id: `model_${Date.now()}`, role: 'model', content: `✅ ¡Cambios aplicados a \`${activeFile.path}\` y confirmados con éxito!` };
          const updatedHistory = chatHistory.map(m => m.id === message.id ? { ...m, suggestion: null, content: `Cambios aceptados para \`${activeFile.path}\`.` } : m);
          
          setChatHistory([...updatedHistory, successMessage]);

      } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Failed to commit changes to GitHub.";
          console.error("Failed to commit changes:", err);
          const errorAiMessage: ChatMessage = { id: `model_${Date.now()}`, role: 'model', content: `Error al confirmar: ${errorMessage}`, error: errorMessage };
          setChatHistory(prev => [...prev, errorAiMessage]);
      } finally {
          setIsCommitting(false);
      }
  };

  const handleDiscardChanges = (messageId: string) => {
    setChatHistory(prev => prev.map(m => m.id === messageId ? { ...m, suggestion: null, content: 'Sugerencia descartada.' } : m));
  };
  
  const handleNewFile = async () => {
      const path = prompt("Ingresa la ruta y el nombre del nuevo archivo (ej. src/components/Button.tsx):");
      if (!path) return;

      try {
          await api.createFile(token, repo.owner.login, repo.name, path, `feat: Create ${path}`);
          onFileTreeUpdate();
          handleFileSelect(path);
      } catch (err) {
          setError(`Error al crear el archivo: ${(err as Error).message}`);
      }
  };

  const handleDeleteFile = async (path: string, sha: string) => {
      if (!confirm(`¿Estás seguro de que quieres eliminar "${path}"? Esta acción no se puede deshacer.`)) return;

      try {
          await api.deleteFile(token, repo.owner.login, repo.name, path, sha, `feat: Delete ${path}`);
          handleCloseTab(new MouseEvent('click'), path); // Simulate click to close tab
          onFileTreeUpdate();
      } catch (err) {
          setError(`Error al eliminar el archivo: ${(err as Error).message}`);
      }
  };

  useEffect(() => {
    if (promptTextareaRef.current) {
        promptTextareaRef.current.style.height = 'auto';
        promptTextareaRef.current.style.height = `${Math.min(promptTextareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleGenerateClick();
    }
  }

  const isGeminiProvider = aiConfig.provider === AIProvider.GEMINI;

  return (
    <div className="flex h-[calc(100vh-11rem)]">
      <div className="w-1/4 max-w-xs bg-[#122024]/50 border-r border-[#15333B] p-2 flex flex-col">
         <div className="p-2 mb-2">
            <button onClick={onBackToRepos} className="flex items-center text-sm text-[#40FDAE] hover:text-[#35e09b] mb-2">
              <BackArrowIcon className="h-4 w-4 mr-1"/>
              Cambiar Repositorio
            </button>
            <h3 className="font-bold text-lg truncate" title={repo.name}>{repo.name}</h3>
            <p className="text-xs text-gray-500">{repo.owner.login}</p>
         </div>
        <FileTree fileTree={repo.fileTree} selectedFile={activeFilePath} onFileSelect={handleFileSelect} onNewFile={handleNewFile} onDeleteFile={handleDeleteFile} />
      </div>

      <div className="flex-1 flex flex-col bg-[#171925]">
        {openFiles.length > 0 ? (
            <div className="flex-1 flex flex-col min-h-0 relative">
                <div className="flex items-center bg-[#1C232E] border-b border-[#15333B] overflow-x-auto">
                    {openFiles.map(file => (
                        <button 
                            key={file.path} 
                            onClick={() => setActiveFilePath(file.path)}
                            className={`flex items-center p-3 text-sm border-r border-[#15333B] whitespace-nowrap ${activeFilePath === file.path ? 'bg-[#171925] text-white' : 'text-gray-400 hover:bg-[#122024]'}`}
                        >
                           <span className="truncate max-w-xs">{file.path.split('/').pop()}</span>
                           <span onClick={(e) => handleCloseTab(e, file.path)} className="ml-3 p-0.5 rounded-full hover:bg-white/20">
                            <CloseIcon className="h-4 w-4" />
                           </span>
                        </button>
                    ))}
                </div>
                {isLoadingFile && <div className="absolute inset-0 flex items-center justify-center bg-[#171925]/80 z-10"><Spinner size="lg"/></div>}
                
                <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-6">
                    {chatHistory.map((msg) => (
                        <div key={msg.id} className={`flex items-start gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                             {msg.role === 'model' && (
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#15333B] flex items-center justify-center">
                                    <SparklesIcon className="w-5 h-5 text-[#40FDAE]"/>
                                </div>
                            )}
                            <div className={`w-full max-w-2xl rounded-lg p-4 ${msg.role === 'user' ? 'bg-[#047AF6]/20' : 'bg-[#122024]'}`}>
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                                {msg.isLoading && <div className="flex items-center space-x-2 pt-2"><Spinner size="sm"/><span>Pensando...</span></div>}
                                {msg.suggestion && msg.fileContent && (
                                    <div className="mt-4 border-t border-[#15333B] pt-4">
                                        <div className="max-h-96 overflow-y-auto rounded-md bg-[#171925]">
                                            <DiffViewer originalCode={msg.fileContent} newCode={msg.suggestion} />
                                        </div>
                                        <div className="flex space-x-2 mt-4">
                                            <Button onClick={() => handleDiscardChanges(msg.id)} variant="secondary" disabled={isCommitting}>Descartar</Button>
                                            <Button onClick={() => handleAcceptChanges(msg)} isLoading={isCommitting} disabled={isCommitting}>Aceptar y Confirmar</Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {msg.role === 'user' && (
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#15333B] flex items-center justify-center">
                                    <UserIcon className="w-5 h-5 text-gray-300"/>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <div className="bg-[#122024]/50 p-4 border-t border-[#15333B]">
                     {error && <div className="p-3 mb-2 text-sm text-red-300 bg-red-900/20 rounded-lg">{error}</div>}
                    <div className="flex items-start space-x-3">
                        <textarea
                            ref={promptTextareaRef}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={activeFile ? `Pregunta a la IA sobre ${activeFile.path.split('/').pop()}... (Shift+Enter para nueva línea)` : 'Abre un archivo para chatear con la IA...'}
                            className="flex-1 px-4 py-2 bg-[#171925] border border-[#15333B] rounded-lg outline-none focus:ring-2 focus:ring-[#B858FE] resize-none"
                            disabled={isGenerating || !activeFile || isLoadingFile}
                            rows={1}
                        />
                        {isGenerating ? (
                            <Button 
                                onClick={handleStopGeneration} 
                                variant='secondary'
                                disabled={isGeminiProvider}
                                title={isGeminiProvider ? "La detención no es compatible con el proveedor Gemini en este momento." : "Detener la generación"}
                            >
                                Detener
                            </Button>
                        ) : (
                            <Button onClick={handleGenerateClick} disabled={!prompt.trim() || !activeFile || isLoadingFile}>
                                <SparklesIcon className="h-5 w-5 mr-2"/>
                                Generar
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 p-4">
                <h3 className="text-lg font-semibold">Bienvenido al Asistente de Código</h3>
                <p>Selecciona un archivo del explorador a la izquierda para empezar a editar y chatear con la IA.</p>
            </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[#171925]/80 backdrop-blur-sm border-t border-[#15333B]">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-end">
            <Button onClick={() => onDeployClick(repo)}>Desplegar Proyecto</Button>
        </div>
      </div>
    </div>
  );
};

export default CodeAssistant;