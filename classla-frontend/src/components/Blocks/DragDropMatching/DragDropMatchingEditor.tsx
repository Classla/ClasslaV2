import React, { useState, useEffect, memo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  DragDropMatchingData,
  DragDropMatchingItem,
  DragDropMatchingTarget,
  validateDragDropMatchingData,
} from "../../extensions/DragDropMatchingBlock";
import { generateUUID } from "../../extensions/blockUtils";
import { Plus, Trash2, AlertTriangle, X, GripVertical } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { Checkbox } from "../../ui/checkbox";
import { ChevronDown, ChevronUp } from "lucide-react";

interface DragDropMatchingEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const DragDropMatchingEditor: React.FC<DragDropMatchingEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const dragDropMatchingData = node.attrs
      .dragDropMatchingData as DragDropMatchingData;
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [showGradingSetup, setShowGradingSetup] = useState(false);

    const updateDragDropMatchingData = useCallback(
      (updates: Partial<DragDropMatchingData>) => {
        const newData = { ...dragDropMatchingData, ...updates };
        const validation = validateDragDropMatchingData(newData);
        setValidationErrors(validation.errors);
        updateAttributes({ dragDropMatchingData: newData });
      },
      [dragDropMatchingData, updateAttributes]
    );

    useEffect(() => {
      const validation = validateDragDropMatchingData(dragDropMatchingData);
      setValidationErrors(validation.errors);
    }, [dragDropMatchingData]);

    const addSourceItem = useCallback(() => {
      const newItem: DragDropMatchingItem = {
        id: generateUUID(),
        text: "",
      };
      updateDragDropMatchingData({
        sourceItems: [...dragDropMatchingData.sourceItems, newItem],
      });
    }, [dragDropMatchingData, updateDragDropMatchingData]);

    const removeSourceItem = useCallback(
      (itemId: string) => {
        const newItems = dragDropMatchingData.sourceItems.filter(
          (item) => item.id !== itemId
        );
        // Also remove from all target zones' correctItemIds
        const newZones = dragDropMatchingData.targetZones.map((zone) => ({
          ...zone,
          correctItemIds: zone.correctItemIds.filter((id) => id !== itemId),
        }));
        updateDragDropMatchingData({
          sourceItems: newItems,
          targetZones: newZones,
        });
      },
      [dragDropMatchingData, updateDragDropMatchingData]
    );

    const updateSourceItem = useCallback(
      (itemId: string, updates: Partial<DragDropMatchingItem>) => {
        const newItems = dragDropMatchingData.sourceItems.map((item) =>
          item.id === itemId ? { ...item, ...updates } : item
        );
        updateDragDropMatchingData({ sourceItems: newItems });
      },
      [dragDropMatchingData, updateDragDropMatchingData]
    );

    const addTargetZone = useCallback(() => {
      const newZone: DragDropMatchingTarget = {
        id: generateUUID(),
        label: "",
        correctItemIds: [],
      };
      updateDragDropMatchingData({
        targetZones: [...dragDropMatchingData.targetZones, newZone],
      });
    }, [dragDropMatchingData, updateDragDropMatchingData]);

    const removeTargetZone = useCallback(
      (zoneId: string) => {
        const newZones = dragDropMatchingData.targetZones.filter(
          (zone) => zone.id !== zoneId
        );
        updateDragDropMatchingData({ targetZones: newZones });
      },
      [dragDropMatchingData, updateDragDropMatchingData]
    );

    const updateTargetZone = useCallback(
      (zoneId: string, updates: Partial<DragDropMatchingTarget>) => {
        const newZones = dragDropMatchingData.targetZones.map((zone) =>
          zone.id === zoneId ? { ...zone, ...updates } : zone
        );
        updateDragDropMatchingData({ targetZones: newZones });
      },
      [dragDropMatchingData, updateDragDropMatchingData]
    );

    const toggleItemInZone = useCallback(
      (zoneId: string, itemId: string) => {
        const zone = dragDropMatchingData.targetZones.find(
          (z) => z.id === zoneId
        );
        if (!zone) return;

        const isIncluded = zone.correctItemIds.includes(itemId);
        let newCorrectItemIds: string[];

        if (dragDropMatchingData.matchType === "one-to-one") {
          // Remove from all other zones first
          const newZones = dragDropMatchingData.targetZones.map((z) => ({
            ...z,
            correctItemIds: z.correctItemIds.filter((id) => id !== itemId),
          }));

          // Then add to this zone if not already included
          if (!isIncluded) {
            newCorrectItemIds = [itemId];
          } else {
            newCorrectItemIds = [];
          }

          updateDragDropMatchingData({
            targetZones: newZones.map((z) =>
              z.id === zoneId
                ? { ...z, correctItemIds: newCorrectItemIds }
                : z
            ),
          });
        } else {
          // Many-to-one: allow multiple items per zone
          if (isIncluded) {
            newCorrectItemIds = zone.correctItemIds.filter(
              (id) => id !== itemId
            );
          } else {
            newCorrectItemIds = [...zone.correctItemIds, itemId];
          }
          updateTargetZone(zoneId, { correctItemIds: newCorrectItemIds });
        }
      },
      [dragDropMatchingData, updateDragDropMatchingData, updateTargetZone]
    );

    // Event handlers to prevent ProseMirror interference
    const handleInputMouseDown = useCallback(
      (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.stopPropagation();
        if ((e.target as HTMLElement).tagName === "TEXTAREA") {
          return;
        }
        e.preventDefault();
        setTimeout(() => {
          (e.target as HTMLInputElement | HTMLTextAreaElement)?.focus();
        }, 0);
      },
      []
    );

    const handleInputClick = useCallback(
      (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.stopPropagation();
        (e.target as HTMLInputElement | HTMLTextAreaElement)?.focus();
      },
      []
    );

    const handleInputEvent = useCallback((e: React.SyntheticEvent) => {
      e.stopPropagation();
    }, []);

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.stopPropagation();
      },
      []
    );

    return (
      <NodeViewWrapper
        className="drag-drop-matching-editor-wrapper"
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
        <div className="drag-drop-matching-editor border border-gray-200 rounded-lg p-3 bg-white shadow-sm select-none">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  validationErrors.length > 0
                    ? "bg-red-100 text-red-600"
                    : "bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-sm"
                }`}
              >
                {validationErrors.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <GripVertical className="w-5 h-5" />
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-gray-900">
                  Drag-and-Drop Matching
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
            <Label className="text-sm font-medium text-gray-700 mb-1 block">
              Instruction
            </Label>
            <Textarea
              value={dragDropMatchingData.instruction}
              onChange={(e) =>
                updateDragDropMatchingData({ instruction: e.target.value })
              }
              onMouseDown={handleInputMouseDown}
              onClick={handleInputClick}
              onFocus={handleInputEvent}
              onBlur={handleInputEvent}
              onKeyDown={handleInputEvent}
              onKeyUp={handleInputEvent}
              onKeyPress={handleInputEvent}
              onInput={handleInputEvent}
              onMouseUp={handleInputEvent}
              onMouseMove={handleInputEvent}
              onPaste={handlePaste}
              placeholder="e.g., Match each term with its definition"
              className="w-full"
              rows={2}
            />
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium text-gray-700">
                Source Items (Draggable)
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={addSourceItem}
                className="text-xs"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add Item
              </Button>
            </div>
            <div className="space-y-2">
              {dragDropMatchingData.sourceItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-200 rounded"
                >
                  <GripVertical className="w-4 h-4 text-gray-400" />
                  <Input
                    value={item.text}
                    onChange={(e) =>
                      updateSourceItem(item.id, { text: e.target.value })
                    }
                    onMouseDown={handleInputMouseDown}
                    onClick={handleInputClick}
                    onFocus={handleInputEvent}
                    onBlur={handleInputEvent}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (item.text.trim()) {
                          addSourceItem();
                          // Focus will be on the new item's input after state update
                          setTimeout(() => {
                            const inputs = document.querySelectorAll(
                              'input[placeholder="Item text..."]'
                            );
                            const lastInput = inputs[inputs.length - 1] as HTMLInputElement;
                            lastInput?.focus();
                          }, 0);
                        }
                      }
                    }}
                    onKeyUp={handleInputEvent}
                    onKeyPress={handleInputEvent}
                    onInput={handleInputEvent}
                    onMouseUp={handleInputEvent}
                    onMouseMove={handleInputEvent}
                    onPaste={handlePaste}
                    placeholder="Item text..."
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSourceItem(item.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium text-gray-700">
                Target Zones (Drop Areas)
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={addTargetZone}
                className="text-xs"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add Zone
              </Button>
            </div>
            <div className="space-y-3">
              {dragDropMatchingData.targetZones.map((zone) => (
                <div
                  key={zone.id}
                  className="p-3 bg-purple-50 border border-purple-200 rounded"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Input
                      value={zone.label}
                      onChange={(e) =>
                        updateTargetZone(zone.id, { label: e.target.value })
                      }
                      onMouseDown={handleInputMouseDown}
                      onClick={handleInputClick}
                      onFocus={handleInputEvent}
                      onBlur={handleInputEvent}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (zone.label.trim()) {
                            addTargetZone();
                            // Focus will be on the new zone's input after state update
                            setTimeout(() => {
                              const inputs = document.querySelectorAll(
                                'input[placeholder="Zone label..."]'
                              );
                              const lastInput = inputs[inputs.length - 1] as HTMLInputElement;
                              lastInput?.focus();
                            }, 0);
                          }
                        }
                      }}
                      onKeyUp={handleInputEvent}
                      onKeyPress={handleInputEvent}
                      onInput={handleInputEvent}
                      onMouseUp={handleInputEvent}
                      onMouseMove={handleInputEvent}
                      onPaste={handlePaste}
                      placeholder="Zone label..."
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeTargetZone(zone.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="text-xs text-gray-600 mb-2">
                    Select correct items for this zone:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {dragDropMatchingData.sourceItems.map((item) => (
                      <label
                        key={item.id}
                        className="flex items-center gap-1 px-2 py-1 bg-white border border-gray-300 rounded cursor-pointer hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={zone.correctItemIds.includes(item.id)}
                          onChange={() => toggleItemInZone(zone.id, item.id)}
                          className="accent-purple-600"
                        />
                        <span className="text-xs">{item.text || "Untitled"}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <Label className="text-sm font-medium text-gray-700 mb-2 block">
              Match Type
            </Label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() =>
                  updateDragDropMatchingData({ matchType: "one-to-one" })
                }
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  dragDropMatchingData.matchType === "one-to-one"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                One-to-one
              </button>
              <button
                type="button"
                onClick={() =>
                  updateDragDropMatchingData({ matchType: "many-to-one" })
                }
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  dragDropMatchingData.matchType === "many-to-one"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Many-to-one
              </button>
            </div>
            <p className="text-xs text-gray-500">
              {dragDropMatchingData.matchType === "one-to-one"
                ? "Each item matches one zone"
                : "Multiple items can match the same zone"}
            </p>
          </div>

          <div className="mb-3 flex items-center space-x-2">
            <Checkbox
              id="randomizeItems"
              checked={dragDropMatchingData.randomizeItems}
              onCheckedChange={(checked) =>
                updateDragDropMatchingData({ randomizeItems: !!checked })
              }
            />
            <Label htmlFor="randomizeItems" className="text-sm">
              Randomize source items order
            </Label>
          </div>

          {/* Grading Setup - Collapsible - At Bottom */}
          <div className="mt-4 border border-gray-200 rounded-md">
            <button
              type="button"
              onClick={() => setShowGradingSetup(!showGradingSetup)}
              className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span className="text-sm font-medium text-gray-700">
                Grading Setup
              </span>
              {showGradingSetup ? (
                <ChevronUp className="w-4 h-4 text-gray-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-600" />
              )}
            </button>
            {showGradingSetup && (
              <div className="p-3 space-y-3 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-gray-700">Points</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={dragDropMatchingData.points}
                    onChange={(e) =>
                      updateDragDropMatchingData({
                        points: parseFloat(e.target.value) || 0,
                      })
                    }
                    onMouseDown={handleInputMouseDown}
                    onClick={handleInputClick}
                    onFocus={handleInputEvent}
                    onBlur={handleInputEvent}
                    onKeyDown={handleInputEvent}
                    onKeyUp={handleInputEvent}
                    onKeyPress={handleInputEvent}
                    onInput={handleInputEvent}
                    onMouseUp={handleInputEvent}
                    onMouseMove={handleInputEvent}
                    onPaste={handlePaste}
                    className="w-24"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="partialCredit"
                    checked={dragDropMatchingData.partialCredit}
                    onCheckedChange={(checked) =>
                      updateDragDropMatchingData({ partialCredit: !!checked })
                    }
                  />
                  <Label htmlFor="partialCredit" className="text-sm">
                    Allow partial credit
                  </Label>
                </div>
              </div>
            )}
          </div>

          {/* Footer info */}
          <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-500 space-y-2 select-none">
            <div className="flex justify-between items-center">
              <span>Drag-and-drop matching</span>
              <span>{dragDropMatchingData.points} points</span>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default DragDropMatchingEditor;

