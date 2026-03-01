import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { BookOpen, Layout, Server } from "lucide-react";

const AdminDashboard = () => {
  const cards = [
    {
      title: "Official Courses",
      description: "Manage official Classla courses and auto-enrollment",
      icon: BookOpen,
      href: "/admin/official-courses",
      enabled: true,
    },
    {
      title: "Course Templates",
      description: "Manage official course curriculum templates",
      icon: Layout,
      href: "/admin/templates",
      enabled: false,
    },
    {
      title: "IDE Management",
      description: "Monitor and manage IDE containers",
      icon: Server,
      href: "/admin/ide",
      enabled: true,
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Admin Panel</h1>
        <p className="text-muted-foreground mt-1">
          System administration and management
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card) => {
          const Icon = card.icon;
          const content = (
            <Card
              className={`border border-border transition-all duration-200 ${
                card.enabled
                  ? "hover:border-purple-500 dark:hover:border-purple-700 hover:shadow-md cursor-pointer"
                  : "opacity-60 cursor-default"
              }`}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
                    <Icon className="w-6 h-6 text-purple-600 dark:text-purple-300" />
                  </div>
                  {!card.enabled && (
                    <Badge variant="secondary">Coming Soon</Badge>
                  )}
                </div>
                <CardTitle className="text-foreground">{card.title}</CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          );

          if (card.enabled) {
            return (
              <Link key={card.title} to={card.href}>
                {content}
              </Link>
            );
          }

          return <div key={card.title}>{content}</div>;
        })}
      </div>
    </div>
  );
};

export default AdminDashboard;
