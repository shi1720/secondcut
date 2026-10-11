import Studio from './studio';
import { getChatGPTUser } from './chatgpt-auth';
export default async function Home() {
  const user = await getChatGPTUser();
  return <Studio user={user ? { name: user.fullName || user.displayName, email: user.email } : null} />;
}
