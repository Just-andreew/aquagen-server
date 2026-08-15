const fs = require('fs');

// Patch App.tsx
let app = fs.readFileSync('C:/Dev/aquagen-farm/src/App.tsx', 'utf8');
app = app.replace(
  '<Route path="/" element={<Navigate to="/dashboard" replace />} />',
  '<Route path="/" element={<RootRedirect />} />'
);
app = app.replace(
  'const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {',
  'const RootRedirect = () => {\n  const { user, loading } = useAuth();\n  if (loading) return null;\n  if (user?.role === "admin" || user?.role === "super-admin") return <Navigate to="/admin" replace />;\n  return <Navigate to="/dashboard" replace />;\n};\n\nconst ProtectedRoute = ({ children }: { children: React.ReactNode }) => {'
);
fs.writeFileSync('C:/Dev/aquagen-farm/src/App.tsx', app);

// Patch LoginPage.tsx
let loginPage = fs.readFileSync('C:/Dev/aquagen-farm/src/components/LoginPage.tsx', 'utf8');
loginPage = loginPage.replace(
  'const { login, isAuthenticated } = useAuth();',
  'const { login, isAuthenticated, user } = useAuth();'
);
loginPage = loginPage.replace(
  'if (isAuthenticated) {\n      navigate(\'/dashboard\');\n    }',
  'if (isAuthenticated && user) {\n      if (user.role === "admin" || user.role === "super-admin") {\n        navigate("/admin");\n      } else {\n        navigate("/dashboard");\n      }\n    }'
);
loginPage = loginPage.replace(
  "toast.success('Login successful');\n      navigate('/dashboard');",
  "toast.success('Login successful');"
);
fs.writeFileSync('C:/Dev/aquagen-farm/src/components/LoginPage.tsx', loginPage);
console.log('Patched correctly');
