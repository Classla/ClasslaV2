import React, { useState, useEffect, memo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  TabbedContentData,
  TabbedContentTab,
  validateTabbedContentData,
} from "../../extensions/TabbedContentBlock";
import { generateUUID } from "../../extensions/blockUtils";
import { Plus, Trash2, AlertTriangle, X, GripVertical } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import RichTextEditor from "../../RichTextEditor";

interface TabbedContentEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const TabbedContentEditor: React.FC<TabbedContentEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const tabbedContentData = node.attrs
      .tabbedContentData as TabbedContentData;
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | undefined>(
      tabbedContentData.defaultActiveTab || tabbedContentData.tabs[0]?.id
    );

    const updateTabbedContentData = useCallback(
      (updates: Partial<TabbedContentData>) => {
        const newData = { ...tabbedContentData, ...updates };
        const validation = validateTabbedContentData(newData);
        setValidationErrors(validation.errors);
        updateAttributes({ tabbedContentData: newData });
      },
      [tabbedContentData, updateAttributes]
    );

    useEffect(() => {
      const validation = validateTabbedContentData(tabbedContentData);
      setValidationErrors(validation.errors);
    }, [tabbedContentData]);

    const addTab = useCallback(() => {
      const newTab: TabbedContentTab = {
        id: generateUUID(),
        label: `Tab ${tabbedContentData.tabs.length + 1}`,
        content: "",
      };
      const newTabs = [...tabbedContentData.tabs, newTab];
      updateTabbedContentData({ tabs: newTabs });
      setActiveTabId(newTab.id);
    }, [tabbedContentData, updateTabbedContentData]);

    const removeTab = useCallback(
      (tabId: string) => {
        const newTabs = tabbedContentData.tabs.filter((tab) => tab.id !== tabId);
        updateTabbedContentData({ tabs: newTabs });
        if (activeTabId === tabId && newTabs.length > 0) {
          setActiveTabId(newTabs[0].id);
        }
      },
      [tabbedContentData, updateTabbedContentData, activeTabId]
    );

    const updateTab = useCallback(
      (tabId: string, updates: Partial<TabbedContentTab>) => {
        const newTabs = tabbedContentData.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, ...updates } : tab
        );
        updateTabbedContentData({ tabs: newTabs });
      },
      [tabbedContentData, updateTabbedContentData]
    );

    const activeTab = tabbedContentData.tabs.find(
      (tab) => tab.id === activeTabId
    );

    // Event handlers
    const handleInputEvent = useCallback((e: React.SyntheticEvent) => {
      e.stopPropagation();
    }, []);

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
      },
      []
    );

    return (
      <NodeViewWrapper
        className="tabbed-content-editor-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
        onMouseDown={(e: React.MouseEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "INPUT" &&
            target.tagName !== "TEXTAREA" &&
            !target.closest("input") &&
            !target.closest("textarea")
          ) {
            e.stopPropagation();
          }
        }}
        onClick={(e: React.MouseEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "INPUT" &&
            target.tagName !== "TEXTAREA" &&
            !target.closest("input") &&
            !target.closest("textarea")
          ) {
            e.stopPropagation();
          }
        }}
        onPaste={(e: React.ClipboardEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "INPUT" &&
            target.tagName !== "TEXTAREA" &&
            !target.closest("input") &&
            !target.closest("textarea")
          ) {
            e.stopPropagation();
          }
        }}
      >
        <div className="tabbed-content-editor border border-border rounded-lg p-3 bg-card shadow-sm select-none">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  validationErrors.length > 0
                    ? "bg-red-100 text-red-600"
                    : "bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm"
                }`}
              >
                {validationErrors.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <GripVertical className="w-5 h-5" />
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-foreground">
                  Tabbed Content
                </div>
                {validationErrors.length > 0 && (
                  <div className="text-xs text-red-600 mt-0.5">
                    {validationErrors.length} error
                    {validationErrors.length !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteNode}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium text-foreground">Tabs</Label>
              <Button variant="outline" size="sm" onClick={addTab} className="text-xs">
                <Plus className="w-3 h-3 mr-1" />
                Add Tab
              </Button>
            </div>
            <div className="flex gap-2 mb-2 overflow-x-auto">
              {tabbedContentData.tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`flex items-center gap-1 px-3 py-1 rounded border cursor-pointer ${
                    activeTabId === tab.id
                      ? "bg-primary/10 border-primary/20"
                      : "bg-muted border-border"
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <Input
                    value={tab.label}
                    onChange={(e) => updateTab(tab.id, { label: e.target.value })}
                    onMouseDown={handleInputEvent}
                    onClick={handleInputEvent}
                    onFocus={(e) => {
                      handleInputEvent(e);
                      setActiveTabId(tab.id);
                    }}
                    onBlur={handleInputEvent}
                    onKeyDown={handleInputEvent}
                    onKeyUp={handleInputEvent}
                    onKeyPress={handleInputEvent}
                    onInput={handleInputEvent}
                    onMouseUp={handleInputEvent}
                    onMouseMove={handleInputEvent}
                    onPaste={handlePaste}
                    className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0"
                    placeholder="Tab label"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTab(tab.id);
                    }}
                    className="h-4 w-4 p-0 text-red-600 hover:text-red-700"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {activeTab && (
            <div className="mb-3">
              <Label className="text-sm font-medium text-foreground mb-1 block">
                Content for "{activeTab.label}"
              </Label>
              <RichTextEditor
                content={activeTab.content}
                onChange={(content) => updateTab(activeTab.id, { content })}
                placeholder="Enter tab content..."
                className="w-full"
                minHeight="150px"
                maxHeight="400px"
                showToolbar={true}
              />
            </div>
          )}

          <div className="mb-3">
            <Label className="text-sm font-medium text-foreground mb-2 block">
              Tab Position
            </Label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() =>
                  updateTabbedContentData({ tabPosition: "top" })
                }
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  tabbedContentData.tabPosition === "top"
                    ? "bg-purple-600 text-white"
                    : "bg-muted text-foreground hover:bg-accent"
                }`}
              >
                Top (horizontal)
              </button>
              <button
                type="button"
                onClick={() =>
                  updateTabbedContentData({ tabPosition: "left" })
                }
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  tabbedContentData.tabPosition === "left"
                    ? "bg-purple-600 text-white"
                    : "bg-muted text-foreground hover:bg-accent"
                }`}
              >
                Left (vertical)
              </button>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default TabbedContentEditor;

