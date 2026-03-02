import { Layout } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";

const AdminTemplatesPage = () => {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Course Templates</h1>
        <p className="text-muted-foreground mt-1">
          Manage official course curriculum templates
        </p>
      </div>

      <Card className="border border-border">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
              <Layout className="w-6 h-6 text-purple-600 dark:text-purple-300" />
            </div>
            <CardTitle className="text-foreground">Coming Soon</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Official course templates will allow administrators to create and manage
            standardized curriculum that instructors can use as a starting point for
            their courses. This feature is currently under development.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminTemplatesPage;
