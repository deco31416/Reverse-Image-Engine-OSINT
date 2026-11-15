import { Suspense } from "react";
import { AuthPage } from "@/components/auth/auth-pages";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <AuthPage mode="reset" />
    </Suspense>
  );
}
