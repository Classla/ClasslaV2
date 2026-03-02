import React, { useState, useEffect } from "react";
import { RubricSchema, RubricType, Rubric } from "../../../../../types";
import { Label } from "../../../../../components/ui/label";
import { Checkbox } from "../../../../../components/ui/checkbox";
import { Input } from "../../../../../components/ui/input";

interface RubricGradingProps {
  rubricSchema: RubricSchema;
  rubric: Rubric | null;
  onUpdate: (values: number[]) => void;
  disabled?: boolean;
}

const RubricGrading: React.FC<RubricGradingProps> = ({
  rubricSchema,
  rubric,
  onUpdate,
  disabled = false,
}) => {
  const [values, setValues] = useState<number[]>(
    rubric?.values || rubricSchema.items.map(() => 0)
  );
  const [valueInputs, setValueInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    if (rubric) {
      setValues(rubric.values);
    } else {
      setValues(rubricSchema.items.map(() => 0));
    }
    setValueInputs({});
  }, [rubric, rubricSchema]);

  const handleCheckboxChange = (index: number, checked: boolean) => {
    const newValues = [...values];
    newValues[index] = checked ? rubricSchema.items[index].points : 0;
    setValues(newValues);
    onUpdate(newValues);
  };

  const handleNumericalChange = (index: number, value: string) => {
    const numValue = parseFloat(value) || 0;
    const maxPoints = rubricSchema.items[index].points;
    // Clamp value between 0 and max points
    const clampedValue = Math.max(0, Math.min(numValue, maxPoints));
    const newValues = [...values];
    newValues[index] = clampedValue;
    setValues(newValues);
    onUpdate(newValues);
  };

  const totalScore = values.reduce((sum, val) => sum + val, 0);
  const maxScore = rubricSchema.items.reduce(
    (sum, item) =>
      item.points > 0 && !item.isExtraCredit ? sum + item.points : sum,
    0
  );

  return (
    <div className="space-y-4 p-4 border border-border rounded-lg bg-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h4 className="text-sm font-bold text-foreground">
          {rubricSchema.title}
        </h4>
        <div className="text-sm font-semibold text-primary">
          {totalScore} / {maxScore} pts
        </div>
      </div>

      <div className="space-y-3">
        {rubricSchema.items.map((item, index) => {
          const isNegative = item.points < 0;
          const isExtraCredit = item.isExtraCredit || false;
          const isChecked = values[index] === item.points;

          return (
            <div
              key={index}
              className={`p-3 rounded-md border ${
                isNegative
                  ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
                  : isExtraCredit
                  ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30"
                  : "border-primary/30 bg-primary/10"
              }`}
            >
              {rubricSchema.type === RubricType.CHECKBOX ? (
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`rubric-item-${index}`}
                    checked={isChecked}
                    onCheckedChange={(checked) =>
                      handleCheckboxChange(index, checked as boolean)
                    }
                    disabled={disabled}
                    className={
                      isNegative
                        ? "data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
                        : isExtraCredit
                        ? "data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                        : "data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                    }
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={`rubric-item-${index}`}
                      className="text-sm font-medium text-foreground cursor-pointer"
                    >
                      {item.title}
                    </Label>
                    <div
                      className={`text-xs font-semibold mt-1 ${
                        isNegative
                          ? "text-red-700"
                          : isExtraCredit
                          ? "text-blue-700"
                          : "text-primary"
                      }`}
                    >
                      {isNegative ? "" : "+"}
                      {item.points} pts
                      {isExtraCredit && " (Extra Credit)"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label
                    htmlFor={`rubric-item-${index}`}
                    className="text-sm font-medium text-foreground"
                  >
                    {item.title}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`rubric-item-${index}`}
                      type="number"
                      value={index in valueInputs ? valueInputs[index] : values[index]}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setValueInputs(prev => ({ ...prev, [index]: raw }));
                        const parsed = parseFloat(raw);
                        if (!isNaN(parsed)) {
                          handleNumericalChange(index, raw);
                        }
                      }}
                      onBlur={() => {
                        const raw = valueInputs[index];
                        if (raw !== undefined) {
                          const parsed = parseFloat(raw);
                          const maxPoints = rubricSchema.items[index].points;
                          const finalValue = isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, maxPoints));
                          const newValues = [...values];
                          newValues[index] = finalValue;
                          setValues(newValues);
                          onUpdate(newValues);
                          setValueInputs(prev => {
                            const next = { ...prev };
                            delete next[index];
                            return next;
                          });
                        }
                      }}
                      disabled={disabled}
                      min={0}
                      max={item.points}
                      step={0.5}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">
                      / {item.points} pts
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rubricSchema.use_for_grading && (
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            This rubric score is included in the final grade calculation
          </p>
        </div>
      )}
    </div>
  );
};

export default RubricGrading;
