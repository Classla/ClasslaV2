import React, { useState, memo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { TabbedContentData } from "../../extensions/TabbedContentBlock";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../ui/tabs";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Typography from "@tiptap/extension-typography";

interface TabbedContentViewerProps {
  node: any;
  editor: any;
}

const TabbedContentViewer: React.FC<TabbedContentViewerProps> = memo(
  ({ node }) => {
    const tabbedContentData = node.attrs
      .tabbedContentData as TabbedContentData;
    const [activeTab, setActiveTab] = useState<string>(
      tabbedContentData.defaultActiveTab || tabbedContentData.tabs[0]?.id || ""
    );

    const contentEditor = useEditor({
      extensions: [StarterKit, Typography],
      content: "",
      editable: false,
    });

    const activeTabData = tabbedContentData.tabs.find(
      (tab) => tab.id === activeTab
    );

    React.useEffect(() => {
      if (contentEditor && activeTabData) {
        contentEditor.commands.setContent(activeTabData.content);
      }
    }, [contentEditor, activeTabData]);

    if (tabbedContentData.tabs.length === 0) {
      return (
        <NodeViewWrapper
          className="tabbed-content-viewer-wrapper"
          as="div"
          draggable={false}
          contentEditable={false}
        >
          <div className="tabbed-content-viewer border border-border rounded-lg p-4 bg-card">
            <p className="text-sm text-muted-foreground">No tabs configured</p>
          </div>
        </NodeViewWrapper>
      );
    }

    return (
      <NodeViewWrapper
        className="tabbed-content-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div className="tabbed-content-viewer border border-border rounded-lg p-4 bg-card">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            orientation={tabbedContentData.tabPosition === "left" ? "vertical" : "horizontal"}
            className={tabbedContentData.tabPosition === "left" ? "flex gap-4" : ""}
          >
            <TabsList
              className={
                tabbedContentData.tabPosition === "left"
                  ? "flex-col h-auto w-auto"
                  : "w-full"
              }
            >
              {tabbedContentData.tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.icon && <span className="mr-1">{tab.icon}</span>}
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabbedContentData.tabs.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="mt-4">
                <div
                  className="prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: tab.content }}
                />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default TabbedContentViewer;

