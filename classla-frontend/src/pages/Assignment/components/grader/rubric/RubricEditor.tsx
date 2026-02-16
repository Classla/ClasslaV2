import React, { useState, useEffect } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "../../../../../components/ui/button";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import { RubricSchema, RubricType, RubricItem } from "../../../../../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../../components/ui/select";
import { Checkbox } from "../../../../../components/ui/checkbox";

interface RubricEditorProps {
  rubricSchema: RubricSchema | null;
  onSave: (schema: Partial<RubricSchema>) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const RubricEditor: React.FC<RubricEditorProps> = ({
  rubricSchema,
  onSave,
  onDelete,
}) => {
  const [title, setTitle] = useState(rubricSchema?.title || "Grading Rubric");
  const [type, setType] = useState<RubricType>(
    rubricSchema?.type || RubricType.CHECKBOX
  );
  const [useForGrading, setUseForGrading] = useState(
    rubricSchema?.use_for_grading ?? true
  );
  const [items, setItems] = useState<RubricItem[]>(
    rubricSchema?.items || [{ title: "", points: 0, isExtraCredit: false }]
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (rubricSchema) {
      setTitle(rubricSchema.title);
      setType(rubricSchema.type);
      setUseForGrading(rubricSchema.use_for_grading);
      setItems(rubricSchema.items);
    }
  }, [rubricSchema]);

  const addItem = () => {
    setItems([...items, { title: "", points: 0, isExtraCredit: false }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (
    index: number,
    field: keyof RubricItem,
    value: string | number | boolean
  ) => {
    const newItems = [...items];
    if (field === "points") {
      newItems[index][field] = parseFloat(value as string) || 0;
    } else if (field === "isExtraCredit") {
      newItems[index][field] = value as boolean;
    } else {
      newItems[index][field] = value as string;
    }
    setItems(newItems);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        title,
        type,
        use_for_grading: useForGrading,
        items: items.filter((item) => item.title.trim() !== ""),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      onDelete &&
      window.confirm("Are you sure you want to delete this rubric?")
    ) {
      setIsSaving(true);
      try {
        await onDelete();
      } finally {
        setIsSaving(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="rubric-title">Rubric Title</Label>
        <Input
          id="rubric-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter rubric title"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="rubric-type">Rubric Type</Label>
        <Select
          value={type}
          onValueChange={(value) => setType(value as RubricType)}
        >
          <SelectTrigger id="rubric-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={RubricType.CHECKBOX}>
              Checkbox (All or Nothing)
            </SelectItem>
            <SelectItem value={RubricType.NUMERICAL}>
              Numerical (Scale-based)
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {type === RubricType.CHECKBOX
            ? "Students receive full points or zero for each criterion"
            : "Students can receive partial points on a scale for each criterion"}
        </p>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="use-for-grading"
          checked={useForGrading}
          onCheckedChange={(checked) => setUseForGrading(checked as boolean)}
        />
        <Label htmlFor="use-for-grading" className="cursor-pointer">
          Use rubric score in final grade calculation
        </Label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Criteria</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addItem}
            className="h-8"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Criterion
          </Button>
        </div>

        <div className="space-y-2">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-3 border rounded-lg bg-muted"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Input
                  value={item.title}
                  onChange={(e) => updateItem(index, "title", e.target.value)}
                  placeholder="Criterion description"
                  className="bg-background"
                />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">
                      Points:
                    </Label>
                    <Input
                      type="number"
                      value={item.points}
                      onChange={(e) =>
                        updateItem(index, "points", e.target.value)
                      }
                      placeholder="0"
                      className="w-24 bg-background"
                      step={type === RubricType.CHECKBOX ? "1" : "0.5"}
                    />
                    {type === RubricType.CHECKBOX && item.points < 0 && (
                      <span className="text-xs text-red-600 font-medium">
                        (Deduction)
                      </span>
                    )}
                  </div>
                  {item.points > 0 && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`extra-credit-${index}`}
                        checked={item.isExtraCredit || false}
                        onCheckedChange={(checked) =>
                          updateItem(index, "isExtraCredit", checked as boolean)
                        }
                        className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                      />
                      <Label
                        htmlFor={`extra-credit-${index}`}
                        className="text-xs text-foreground cursor-pointer"
                      >
                        Extra Credit (not counted in total)
                      </Label>
                    </div>
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeItem(index)}
                disabled={items.length === 1}
                className="flex-shrink-0"
              >
                <Trash2 className="w-4 h-4 text-red-600" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-4 border-t">
        <Button
          onClick={handleSave}
          disabled={isSaving || items.every((item) => !item.title.trim())}
          className="flex-1"
        >
          {isSaving
            ? "Saving..."
            : rubricSchema
            ? "Update Rubric"
            : "Create Rubric"}
        </Button>
        {rubricSchema && onDelete && (
          <Button
            onClick={handleDelete}
            disabled={isSaving}
            variant="destructive"
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
};

export default RubricEditor;
