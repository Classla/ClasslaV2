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

  useEffect(() => {
    if (rubric) {
      setValues(rubric.values);
    } else {
      setValues(rubricSchema.items.map(() => 0));
    }
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
    (sum, item) => sum + item.points,
    0
  );

  return (
    <div className="space-y-4 p-4 border border-gray-200 rounded-lg bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <h4 className="text-sm font-bold text-gray-900">
          {rubricSchema.title}
        </h4>
        <div className="text-sm font-semibold text-purple-700">
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
                  ? "border-red-200 bg-red-50"
                  : isExtraCredit
                  ? "border-blue-200 bg-blue-50"
                  : "border-purple-200 bg-purple-50"
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
                      className="text-sm font-medium text-gray-900 cursor-pointer"
                    >
                      {item.title}
                    </Label>
                    <div
                      className={`text-xs font-semibold mt-1 ${
                        isNegative
                          ? "text-red-700"
                          : isExtraCredit
                          ? "text-blue-700"
                          : "text-purple-700"
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
                    className="text-sm font-medium text-gray-900"
                  >
                    {item.title}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`rubric-item-${index}`}
                      type="number"
                      value={values[index]}
                      onChange={(e) =>
                        handleNumericalChange(index, e.target.value)
                      }
                      disabled={disabled}
                      min={0}
                      max={item.points}
                      step={0.5}
                      className="w-24"
                    />
                    <span className="text-sm text-gray-600">
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
        <div className="pt-3 border-t border-gray-200">
          <p className="text-xs text-gray-600">
            This rubric score is included in the final grade calculation
          </p>
        </div>
      )}
    </div>
  );
};

export default RubricGrading;
