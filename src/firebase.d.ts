// Firebase compat SDK loaded via CDN
interface FirebaseDatabase {
  ref(path?: string): FirebaseRef;
}

interface FirebaseRef {
  on(event: string, callback: (snapshot: FirebaseSnapshot) => void): void;
  set(value: any): Promise<void>;
  push(value?: any): Promise<FirebaseRef> & { key: string };
  update(value: any): Promise<void>;
  remove(): Promise<void>;
  child(path: string): FirebaseRef;
  onDisconnect(): { remove(): void };
  key: string;
}

interface FirebaseSnapshot {
  key: string;
  val(): any;
  numChildren(): number;
}

interface FirebaseApp {
  database(): FirebaseDatabase;
}

interface FirebaseNamespace {
  initializeApp(config: Record<string, string>): FirebaseApp;
  database(): FirebaseDatabase;
}

declare const firebase: FirebaseNamespace;
