import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../ui/tabs";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { Button } from "../../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { TestCase, InputOutputTestCase, UnitTestCase, ManualGradingTestCase } from "../../extensions/IDEBlock";
import { generateUUID } from "../../extensions/blockUtils";

interface AutograderTestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (testCase: TestCase) => void;
  testCase?: TestCase | null; // For edit mode
}

const AutograderTestModal: React.FC<AutograderTestModalProps> = ({
  open,
  onOpenChange,
  onSave,
  testCase,
}) => {
  const [testName, setTestName] = useState("");
  const [testType, setTestType] = useState<"inputOutput" | "unitTest" | "manualGrading">("inputOutput");
  const [points, setPoints] = useState(1);
  const [input, setInput] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [code, setCode] = useState("");
  const [framework, setFramework] = useState<"junit" | "unittest">("unittest");

  // Initialize form when modal opens or testCase changes
  useEffect(() => {
    if (open) {
      if (testCase) {
        // Edit mode
        setTestName(testCase.name);
        setTestType(testCase.type);
        setPoints(testCase.points);
        if (testCase.type === "inputOutput") {
          setInput(testCase.input);
          setExpectedOutput(testCase.expectedOutput);
        } else if (testCase.type === "unitTest") {
          setCode(testCase.code);
          setFramework(testCase.framework || "unittest");
        }
      } else {
        // Create mode - reset to defaults
        setTestName("");
        setTestType("inputOutput");
        setPoints(1);
        setInput("");
        setExpectedOutput("");
        setCode("");
        setFramework("unittest");
      }
    }
  }, [open, testCase]);

  const handleSave = () => {
    // Validation
    if (!testName.trim()) {
      return; // Name is required
    }

    let newTestCase: TestCase;

    if (testType === "inputOutput") {
      newTestCase = {
        id: testCase?.id || generateUUID(),
        name: testName.trim(),
        type: "inputOutput",
        input: input,
        expectedOutput: expectedOutput,
        points: points,
      } as InputOutputTestCase;
    } else if (testType === "unitTest") {
      newTestCase = {
        id: testCase?.id || generateUUID(),
        name: testName.trim(),
        type: "unitTest",
        code: code,
        points: points,
        framework: framework,
      } as UnitTestCase;
    } else {
      newTestCase = {
        id: testCase?.id || generateUUID(),
        name: testName.trim(),
        type: "manualGrading",
        points: points,
      } as ManualGradingTestCase;
    }

    onSave(newTestCase);
    onOpenChange(false);
  };

  const defaultUnitTestCode = `import unittest # import unittest framework

class Classla_Unit_Test(unittest.TestCase):
    """
    You can add sample tests here, and create multiple functions. 
    Students will see the names of these functions when they fail, 
    so if you would like to make names descriptive to help them you can.
    """
    def sample_test(self):
        self.assertEquals(True)`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{testCase ? "Edit Test Case" : "Create Test Case"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Test Type Tabs */}
          <Tabs value={testType} onValueChange={(value) => setTestType(value as typeof testType)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="inputOutput">Input/Output</TabsTrigger>
              <TabsTrigger value="unitTest">Unit Test</TabsTrigger>
              <TabsTrigger value="manualGrading">Manual Grading</TabsTrigger>
            </TabsList>

            {/* Input/Output Tab */}
            <TabsContent value="inputOutput" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="test-name">Test Name</Label>
                <Input
                  id="test-name"
                  placeholder="Test Name"
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="input">Input (will be passed in to stdin)</Label>
                <Textarea
                  id="input"
                  placeholder="Type input here."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="min-h-[150px] font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expected-output">Expected Output</Label>
                <Textarea
                  id="expected-output"
                  placeholder="Expected output"
                  value={expectedOutput}
                  onChange={(e) => setExpectedOutput(e.target.value)}
                  className="min-h-[150px] font-mono text-sm"
                />
              </div>
            </TabsContent>

            {/* Unit Test Tab */}
            <TabsContent value="unitTest" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="unit-test-framework">Unit testing framework</Label>
                <Select
                  value={framework}
                  onValueChange={(value) => setFramework(value as "junit" | "unittest")}
                >
                  <SelectTrigger id="unit-test-framework">
                    <SelectValue placeholder="Select framework" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unittest">unittest (python)</SelectItem>
                    <SelectItem value="junit">JUnit (java)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-name">Test Name</Label>
                <Input
                  id="test-name"
                  placeholder="Test Name"
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit-test-code">Unit Test Code</Label>
                <Textarea
                  id="unit-test-code"
                  placeholder={defaultUnitTestCode}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="min-h-[300px] font-mono text-sm"
                />
              </div>
            </TabsContent>

            {/* Manual Grading Tab */}
            <TabsContent value="manualGrading" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="test-name">Test Name</Label>
                <Input
                  id="test-name"
                  placeholder="Test Name"
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Manual grading selected. No additional input required.
              </p>
            </TabsContent>
          </Tabs>

          {/* Test Case Value and Create Button */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="flex items-center gap-2">
              <Label htmlFor="test-points">Test Case Value:</Label>
              <Input
                id="test-points"
                type="number"
                min="0"
                step="0.5"
                value={points}
                onChange={(e) => setPoints(parseFloat(e.target.value) || 0)}
                className="w-20"
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={!testName.trim()}
              className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
            >
              {testCase ? "Save" : "+ Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AutograderTestModal;

