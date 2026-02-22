import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { IDEBlockData } from '../components/extensions/IDEBlock';

export type PanelMode = 'none' | 'side-panel' | 'fullscreen';

export interface ContainerInfo {
  id: string;
  status: string;
  urls: {
    codeServer: string;
    vnc: string;
    webServer: string;
    terminal?: string;
  };
}

export interface IDEPanelState {
  ideData: IDEBlockData;
  container: ContainerInfo | null;
  bucketId: string | null;
  isStarting: boolean;
  showDesktop: boolean;
  runFilename: string;
  ideApiBaseUrl: string;
  readOnly?: boolean;
}

interface IDEPanelContextType {
  panelMode: PanelMode;
  activePanelState: IDEPanelState | null;
  openSidePanel: (state: IDEPanelState) => void;
  closeSidePanel: () => void;
  openFullscreen: (state: IDEPanelState) => void;
  updatePanelState: (update: Partial<IDEPanelState>) => void;
}

const IDEPanelContext = createContext<IDEPanelContextType | undefined>(undefined);

export const useIDEPanel = () => {
  const context = useContext(IDEPanelContext);
  if (!context) {
    throw new Error('useIDEPanel must be used within IDEPanelProvider');
  }
  return context;
};

interface IDEPanelProviderProps {
  children: ReactNode;
}

export const IDEPanelProvider: React.FC<IDEPanelProviderProps> = ({ children }) => {
  const [panelMode, setPanelMode] = useState<PanelMode>('none');
  const [activePanelState, setActivePanelState] = useState<IDEPanelState | null>(null);

  const openSidePanel = useCallback((state: IDEPanelState) => {
    setActivePanelState(state);
    setPanelMode('side-panel');
  }, []);

  const closeSidePanel = useCallback(() => {
    setPanelMode('none');
    // Don't clear activePanelState immediately to allow for smooth transition
    setTimeout(() => {
      setActivePanelState(null);
    }, 300);
  }, []);

  const updatePanelState = useCallback((update: Partial<IDEPanelState>) => {
    setActivePanelState(prev => prev ? { ...prev, ...update } : prev);
  }, []);

  const openFullscreen = useCallback((state: IDEPanelState) => {
    // Store full IDE panel state in localStorage for the new tab
    localStorage.setItem(`ide-panel-state-${state.ideData.id}`, JSON.stringify(state));
    
    // Open in new tab
    window.open(`/ide-fullscreen/${state.ideData.id}`, '_blank');
  }, []);

  const value: IDEPanelContextType = {
    panelMode,
    activePanelState,
    openSidePanel,
    closeSidePanel,
    openFullscreen,
    updatePanelState,
  };

  return (
    <IDEPanelContext.Provider value={value}>
      {children}
    </IDEPanelContext.Provider>
  );
};
