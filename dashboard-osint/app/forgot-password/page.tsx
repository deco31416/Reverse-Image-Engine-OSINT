import { Suspense } from "react";
import { AuthPage } from "@/components/auth/auth-pages";

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <AuthPage mode="forgot" />
    </Suspense>
  );
}
