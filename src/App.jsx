import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, addDoc, getDocs, runTransaction, FieldValue } from 'firebase/firestore';
import { Menu, X, Home, Users, Settings, LogIn, Layout, FileText, ClipboardList, Zap, CheckCircle, Save, Trash2, Edit, Plus, ChevronLeft, ChevronRight, CornerDownRight, BarChart3, TrendingUp, Cpu, Hash, Mail, Calendar, Clock, Upload, Globe, Film, Info, HelpCircle, Star, Heart, MessageSquare, ListOrdered, Radio, CheckSquare, AlignJustify, Type, Smartphone, Dribbble, BookOpen, Key, Link, Loader2, Minus, Maximize, Minimize, LogOut, ArrowLeft, Eye, Code } from 'lucide-react';

// --- 1. GLOBAL CONSTANTS AND UTILITIES ---

const INDIGO = '#4f46e5';
const EMERALD = '#10b981';

// Provided global variables (MUST be defined for Canvas environment)
// *** MODIFIED FOR VERCEL DEPLOYMENT ***
// If process.env variables exist (on Vercel), use them. Otherwise, fall back to Canvas variables.
const appId = process.env.REACT_APP_APP_ID || (typeof __app_id !== 'undefined' ? __app_id : 'default-app-id');
const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG) : (typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {});
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Admin Credentials (Used INTERNALLY for demo bypass ONLY)
const ADMIN_EMAIL = 'official.parvej.hossain@gmail.com'; 
const ADMIN_PASSWORD = 'PASSword@789123';

// Database Paths
const PATH_PUBLIC_DATA = `/artifacts/${appId}/public/data`;
const DOC_CONTENT_BUILDER = `${PATH_PUBLIC_DATA}/content_blocks/homepage`;
const DOC_FORM_STRUCTURE = `${PATH_PUBLIC_DATA}/form_structure/mainForm`;
const COL_INVITE_CODES = `${PATH_PUBLIC_DATA}/invite_codes`;
const COL_SUBMISSIONS = `${PATH_PUBLIC_DATA}/submissions`;
const COL_CONTENT_BLOCKS = `${PATH_PUBLIC_DATA}/content_blocks`; // Used for dynamic list queries

// Utility: Random ID Generator (for fields, segments, etc.)
const generateId = (prefix = '') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).substring(2, 5)}`;

// Utility: Simple Client-Side Router
const useRoute = () => {
  const [path, setPath] = useState(window.location.hash.slice(1) || '/home');
  useEffect(() => {
    const handleHashChange = () => setPath(window.location.hash.slice(1) || '/home');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  const navigate = (newPath) => {
    // Ensure the newPath starts with a / for clean hash routing, unless it's empty
    if (newPath && !newPath.startsWith('/')) newPath = '/' + newPath;
    window.location.hash = newPath;
  };
  return { path, navigate };
};

// Utility: Debounce function for input handling
const debounce = (func, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
};

// Utility: CSV and JSON Export (kept simple, assumes flattening)
const exportData = (data, format, filename) => {
    if (!data || data.length === 0) return console.error('No data to export.');

    if (format === 'json') {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } else if (format === 'csv') {
        // ... (CSV logic remains the same)
        const flattenSubmissions = (submissions) => {
            if (!submissions || submissions.length === 0) return [];
            return submissions.map(sub => {
                const flat = {
                    'Submission ID': sub.id,
                    'Name': sub.name || 'N/A',
                    'Email': sub.email || 'N/A',
                    'Submission Date': sub.submissionDate ? new Date(sub.submissionDate.seconds * 1000).toLocaleString() : 'N/A',
                    'Invite Code Used': sub.inviteCode || 'N/A',
                };
                if (sub.answers) {
                    Object.entries(sub.answers).forEach(([key, value]) => {
                        flat[`Answer: ${key}`] = Array.isArray(value) ? value.join(' | ') : (typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
                    });
                }
                return flat;
            });
        };

        const flatData = flattenSubmissions(data);

        if (flatData.length === 0) return;

        const headers = Object.keys(flatData[0]);
        const csv = [
            headers.join(','), // Header row
            ...flatData.map(row => headers.map(header => {
                let value = row[header] === null || row[header] === undefined ? '' : row[header];
                if (typeof value === 'string') {
                    // Escape double quotes and enclose in double quotes if it contains comma or newline
                    value = value.replace(/"/g, '""');
                    if (value.includes(',') || value.includes('\n')) {
                        value = `"${value}"`;
                    }
                }
                return value;
            }).join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};

// --- 2. FIREBASE CONTEXT & INITIALIZATION ---

const AppContext = React.createContext(null);

const FirebaseProvider = ({ children }) => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [user, setUser] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isDemoAdmin, setIsDemoAdmin] = useState(false);

    const login = async (email, password) => {
        // --- DEMO LOGIN BYPASS LOGIC ---
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            const mockUser = { uid: 'DEMO_ADMIN_UID_123', email: ADMIN_EMAIL };
            
            // FIX: Explicitly set state immediately for DEMO bypass 
            setUser(mockUser);
            setIsAdmin(true);
            setIsDemoAdmin(true);
            console.log("Demo Admin Login successful.");
            return { success: true };
        }
        
        try {
            // REAL FIREBASE LOGIN (Only if not demo)
            await signInWithEmailAndPassword(auth, email, password);
            return { success: true };
        } catch (error) {
            console.error("Firebase Login failed:", error);
            return { success: false, message: 'Login Failed. Check credentials.' };
        }
    };

    const logout = async () => {
        if (isDemoAdmin) {
            setIsDemoAdmin(false);
            setUser(null);
            setIsAdmin(false);
            if (auth) {
                try {
                    await signOut(auth);
                    await signInAnonymously(auth);
                } catch (e) {
                    console.error("Error signing out/in anonymously:", e);
                }
            }
        } else if (auth) {
            await signOut(auth);
            await signInAnonymously(auth);
        }
    };

    const seedInitialData = useCallback(async (database) => {
        console.log('Checking for initial data seeding...');
        const contentRef = doc(database, DOC_CONTENT_BUILDER);
        const formRef = doc(database, DOC_FORM_STRUCTURE);

        // Check Content
        if (!(await getDoc(contentRef)).exists()) {
            console.log('Seeding default content blocks...');
            await setDoc(contentRef, {
                published: [
                    { id: generateId('hero'), type: 'HeroBanner', data: { title: 'Join the Islamic University Earth Club Revolution', subtitle: 'Leading sustainable change at Islamic University.', ctaText: 'Click to become a member', ctaLink: '#/register' }, order: 0 },
                    { id: generateId('text'), type: 'RichText', data: { content: '<p><strong>Our Mission:</strong> To cultivate a culture of sustainability and environmental stewardship among students, faculty, and the wider community.</p><p>We focus on waste reduction, biodiversity, and carbon footprint mitigation.</p>' }, order: 1 },
                    { id: generateId('stats'), type: 'Stats/Counters', data: { stats: [ { icon: 'TreePine', value: 1250, label: 'Trees Planted' }, { icon: 'Users', value: 540, label: 'Active Members' }, { icon: 'Recycle', value: 25, label: 'Tons Waste Diverted' } ] }, order: 2 },
                    { id: generateId('chart'), type: 'ChartSimulation', data: { title: '2024 Waste Diversion Goal', chartData: [ { label: 'Paper', value: 45 }, { label: 'Plastic', value: 25 }, { label: 'E-Waste', value: 15 }, { label: 'Glass', value: 15 } ] }, order: 3 },
                    { id: generateId('video'), type: 'VideoEmbed', data: { title: 'IUEC Overview Video', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ?si=7l94n3Yt5jJ6h43s' }, order: 4 },
                ],
                draft: [],
            });
        }

        // Check Form Structure
        if (!(await getDoc(formRef)).exists()) {
            console.log('Seeding default form structure...');
            await setDoc(formRef, {
                segments: [
                    { id: generateId('seg'), title: 'Basic Information', fields: [
                        { id: generateId('f'), type: 'FullName', label: 'Full Name', required: true, placeholder: 'Enter your full name' },
                        { id: generateId('f'), type: 'EmailAddress', label: 'University Email Address', required: true, placeholder: 'name@iu.ac.bd' },
                        { id: generateId('f'), type: 'ShortAnswer', label: 'Department/Program', required: true, placeholder: 'e.g., CSE' },
                    ] },
                    { id: generateId('seg'), title: 'Environmental Interest', fields: [
                        { id: generateId('f'), type: 'MultipleChoice', label: 'Which environmental area interests you most?', required: true, options: ['Climate Action', 'Water Conservation', 'Waste Management', 'Biodiversity'] },
                        { id: generateId('f'), type: 'LinearScale', label: 'How would you rate your commitment to sustainability? (1=Low, 5=High)', required: true, min: 1, max: 5 },
                        { id: generateId('f'), type: 'ImageQuestion', label: 'Identify the best option for plastic recycling:', required: true, imageUrl: 'https://placehold.co/300x200/525252/ffffff?text=Recycling+Image', options: ['Option A (Correct)', 'Option B', 'Option C'], optionalLongText: true },
                    ] },
                    { id: generateId('seg'), title: 'Final Step & Validation', fields: [
                        { id: generateId('f'), type: 'Instructions', label: 'Membership Agreement', content: '<p>By submitting this form, you agree to abide by the Islamic University Earth Club charter and actively participate in at least one club activity per semester.</p>' },
                    ] }
                ]
            });
        }

    }, []);

    useEffect(() => {
        if (!Object.keys(firebaseConfig).length) {
            console.error("Firebase config is missing or empty.");
            setIsLoading(false);
            return;
        }

        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const authService = getAuth(app);

        setDb(firestore);
        setAuth(authService);

        // Set up the authentication state listener
        const unsubscribe = onAuthStateChanged(authService, async (currentUser) => {
            if (currentUser) {
                // If it's a real Firebase user and we are not in a demo state
                if (!isDemoAdmin) { 
                    setUser(currentUser);
                    setIsAdmin(currentUser.email === ADMIN_EMAIL);
                    console.log(`User authenticated: ${currentUser.email || currentUser.uid}. Admin: ${currentUser.email === ADMIN_EMAIL}`);
                }
                // Seed initial data regardless of user type
                await seedInitialData(firestore);
            } else if (!isDemoAdmin) {
                // If no user (logged out or initial load) and not in a demo state, sign in anonymously
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(authService, initialAuthToken);
                    } else {
                        await signInAnonymously(authService);
                    }
                } catch (error) {
                    console.error("Authentication failed during initial load:", error);
                }
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [seedInitialData, isDemoAdmin]);

    const contextValue = useMemo(() => ({
        db,
        auth,
        user,
        isAdmin,
        isLoading,
        login,
        logout,
        userId: user?.uid || (typeof crypto !== 'undefined' ? crypto.randomUUID() : 'anonymous-user'),
    }), [db, auth, user, isAdmin, isLoading, isDemoAdmin]); // isDemoAdmin added to ensure context updates

    return (
        <AppContext.Provider value={contextValue}>
            {children}
        </AppContext.Provider>
    );
};


// --- 3. UI COMPONENTS ---

// Helper component for loading state and UI polish
const LoadingScreen = () => (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-50/90 z-50 transition-opacity duration-500 backdrop-blur-sm">
        <div className="flex flex-col items-center">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
            <p className="mt-4 text-lg font-semibold text-gray-700">Loading Platform...</p>
        </div>
    </div>
);

const IconButton = ({ children, onClick, className = '', disabled = false, Icon }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`flex items-center justify-center p-2 rounded-lg transition duration-200 transform hover:scale-[1.02] active:scale-[0.98] ${disabled ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md hover:shadow-lg'} ${className}`}
    >
        {Icon && <Icon className="w-5 h-5 mr-2" />}
        {children}
    </button>
);

const Card = ({ children, className = '', title, icon: Icon, actions }) => (
    <div className={`bg-white p-6 rounded-2xl shadow-xl transition-all duration-300 hover:shadow-2xl border border-gray-100 ${className}`}>
        {title && (
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
                <h2 className="text-xl font-bold text-gray-800 flex items-center">
                    {Icon && <Icon className="w-6 h-6 mr-2 text-indigo-600" />}
                    {title}
                </h2>
                {actions}
            </div>
        )}
        {children}
    </div>
);

const Modal = ({ isOpen, onClose, title, children, size = 'lg' }) => {
    if (!isOpen) return null;
    const sizeClasses = {
        sm: 'max-w-md',
        lg: 'max-w-3xl',
        xl: 'max-w-5xl',
        full: 'max-w-full m-4 h-[90vh]',
    }[size];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-70 transition-opacity duration-300 backdrop-blur-sm">
            <div className={`relative bg-white rounded-xl shadow-2xl p-6 transform transition-all duration-300 ease-out ${sizeClasses} w-full max-h-[90vh] overflow-y-auto`}>
                <div className="flex items-center justify-between border-b pb-3 mb-4">
                    <h3 className="text-2xl font-semibold text-indigo-700">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
};

// --- 4. HOMEPAGE CONTENT BLOCKS RENDERING ---

const IconMap = {
    Home, Users, Settings, LogIn, Layout, FileText, ClipboardList, Zap, CheckCircle, Save, Trash2, Edit, Plus, ChevronLeft, ChevronRight, CornerDownRight, BarChart3, TrendingUp, Cpu, Hash, Mail, Calendar, Clock, Upload, Globe, Film, Info, HelpCircle, Star, Heart, MessageSquare, ListOrdered, Radio, CheckSquare, AlignJustify, Type, Smartphone, Dribbble, BookOpen, Key, Image: Dribbble, Heading: Type, MultiColumnText: AlignJustify, HTMLEmbed: Code,
    TreePine: ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 2L2 22h20L12 2z"></path><path d="M12 11v11"></path></svg>, 
    Recycle: ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 12V3a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v9"></path><path d="M12 22c5.523 0 10-4.477 10-10H2c0 5.523 4.477 10 10 10z"></path><path d="M7 15h4v4H7z"></path><path d="M13 15h4v4h-4z"></path></svg>
};

const renderBlock = (block, navigate) => {
    const { type, data, id } = block;

    const baseClasses = "my-12 p-8 rounded-2xl shadow-xl bg-white/95 backdrop-blur-sm transition duration-500 ease-in-out transform";

    switch (type) {
        case 'HeroBanner':
            return (
                <div key={id} className={`${baseClasses} text-center py-20 bg-indigo-50 border-t-4 border-indigo-600`}>
                    <h1 className="text-5xl md:text-6xl font-extrabold text-gray-800 animate-fadeInUp delay-100">{data.title}</h1>
                    <p className="mt-4 text-xl md:text-2xl text-indigo-600 font-medium animate-fadeInUp delay-200">{data.subtitle}</p>
                    <button
                        onClick={() => navigate(data.ctaLink)}
                        className="mt-8 px-10 py-4 text-lg font-semibold text-white bg-emerald-500 rounded-full shadow-lg hover:bg-emerald-600 transition duration-300 transform hover:scale-[1.05] active:scale-[0.98] animate-fadeInUp delay-300"
                    >
                        <Zap className="w-5 h-5 inline mr-2" />
                        {data.ctaText}
                    </button>
                </div>
            );

        case 'Heading':
            return (
                <div key={id} className={`${baseClasses} text-center py-6 border-b border-gray-200`}>
                    <h2 className="text-4xl font-extrabold text-gray-800">{data.title}</h2>
                    {data.subtitle && <p className="mt-2 text-lg text-indigo-600">{data.subtitle}</p>}
                </div>
            );

        case 'RichText':
            return (
                <div key={id} className={`${baseClasses} prose max-w-none text-gray-700 animate-fadeInUp`} dangerouslySetInnerHTML={{ __html: data.content }}></div>
            );

        case 'MultiColumnText':
            return (
                <div key={id} className={`${baseClasses} animate-fadeInUp`}>
                    <h2 className="text-3xl font-bold text-gray-800 mb-6">{data.title}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 prose max-w-none" dangerouslySetInnerHTML={{ __html: data.content }}></div>
                </div>
            );
            
        case 'Button':
            return (
                <div key={id} className={`${baseClasses} text-center p-4`}>
                    <button
                        onClick={() => navigate(data.ctaLink)}
                        className="px-8 py-3 text-lg font-semibold text-white bg-indigo-600 rounded-full shadow-lg hover:bg-indigo-700 transition duration-300 transform hover:scale-[1.05] active:scale-[0.98]"
                    >
                        {data.ctaText}
                    </button>
                </div>
            );

        case 'Stats/Counters':
            return (
                <div key={id} className={`${baseClasses} grid grid-cols-1 md:grid-cols-3 gap-8 text-center animate-fadeInUp`}>
                    {data.stats.map((stat, index) => {
                        const Icon = IconMap[stat.icon] || Info;
                        return (
                            <div key={index} className="p-6 rounded-xl bg-indigo-50 shadow-inner hover:bg-indigo-100 transition duration-300 transform hover:translate-y-[-5px]">
                                <Icon className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
                                <div className="text-4xl font-extrabold text-indigo-600">{stat.value.toLocaleString()}+</div>
                                <p className="text-lg font-medium text-gray-600 mt-1">{stat.label}</p>
                            </div>
                        );
                    })}
                </div>
            );

        case 'Image':
            return (
                <div key={id} className={`${baseClasses} text-center p-4 animate-fadeInUp`}>
                    <h2 className="text-3xl font-bold text-gray-800 mb-4">{data.title}</h2>
                    <img
                        src={data.imageUrl || 'https://placehold.co/800x400/4f46e5/ffffff?text=Image+Placeholder'}
                        alt={data.title}
                        className="rounded-xl shadow-2xl w-full h-auto object-cover mx-auto"
                        onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/800x400/4f46e5/ffffff?text=Image+Load+Error'; }}
                    />
                </div>
            );

        case 'VideoEmbed':
            // Simple logic to convert YouTube URL to embed link
            const embedUrl = data.url.includes('youtube.com/watch')
                ? data.url.replace('watch?v=', 'embed/')
                : data.url;

            return (
                <div key={id} className={`${baseClasses} animate-fadeInUp`}>
                    <h2 className="text-3xl font-bold text-gray-800 mb-6">{data.title}</h2>
                    <div className="relative pt-[56.25%] rounded-xl overflow-hidden shadow-2xl">
                        <iframe
                            className="absolute top-0 left-0 w-full h-full"
                            src={embedUrl}
                            title={data.title}
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                        ></iframe>
                    </div>
                </div>
            );
            
        case 'HTMLEmbed':
            return (
                <div key={id} className={`${baseClasses} p-4 animate-fadeInUp bg-gray-900 text-white border-2 border-indigo-500 rounded-xl`}>
                    <h2 className="text-xl font-bold mb-4 flex items-center"><Code className="w-5 h-5 mr-2 text-emerald-400" /> Embedded Content (HTML/Iframe)</h2>
                    <div dangerouslySetInnerHTML={{ __html: data.htmlContent }}></div>
                </div>
            );

        case 'Chart':
            const chartTotal = data.chartData.reduce((sum, item) => sum + item.value, 0);

            if (data.chartType === 'Bar') {
                return (
                    <div key={id} className={`${baseClasses} animate-fadeInUp`}>
                        <h2 className="text-3xl font-bold text-gray-800 mb-6 flex items-center"><BarChart3 className="w-6 h-6 mr-2 text-indigo-600" />{data.title} (Bar Graph)</h2>
                        <div className="flex flex-col gap-4">
                            {data.chartData.map((item, index) => {
                                const percentage = (item.value / chartTotal) * 100;
                                const barColor = ['bg-indigo-500', 'bg-emerald-500', 'bg-red-500', 'bg-yellow-500'][index % 4];
                                return (
                                    <div key={index}>
                                        <div className="flex justify-between mb-1 text-sm font-medium text-gray-700">
                                            <span>{item.label}</span>
                                            <span>{item.value}%</span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2.5 shadow-inner">
                                            <div
                                                className={`${barColor} h-2.5 rounded-full transition-all duration-1000 ease-out`}
                                                style={{ width: `${percentage}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            } else if (data.chartType === 'Pie') {
                const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#3b82f6'];
                let cumulativeAngle = 0;

                return (
                    <div key={id} className={`${baseClasses} animate-fadeInUp text-center`}>
                        <h2 className="text-3xl font-bold text-gray-800 mb-6 flex items-center justify-center"><BarChart3 className="w-6 h-6 mr-2 text-indigo-600" />{data.title} (Pie Chart)</h2>
                        <div className="flex flex-wrap items-start justify-center gap-6">
                            {/* Pie Chart SVG */}
                            <svg className="w-48 h-48 sm:w-64 sm:h-64 shadow-2xl rounded-full" viewBox="0 0 32 32">
                                {data.chartData.map((item, index) => {
                                    const percentage = item.value / chartTotal;
                                    const angle = percentage * 360;
                                    const largeArcFlag = angle > 180 ? 1 : 0;
                                    const radius = 16;
                                    const x1 = radius + radius * Math.sin(cumulativeAngle * Math.PI / 180);
                                    const y1 = radius - radius * Math.cos(cumulativeAngle * Math.PI / 180);
                                    cumulativeAngle += angle;
                                    const x2 = radius + radius * Math.sin(cumulativeAngle * Math.PI / 180);
                                    const y2 = radius - radius * Math.cos(cumulativeAngle * Math.PI / 180);
                                    
                                    const path = angle === 360 
                                        ? `M 16 0 A 16 16 0 1 1 15.999 0 Z`
                                        : `M ${radius},${radius} L ${x1},${y1} A ${radius},${radius} 0 ${largeArcFlag},1 ${x2},${y2} Z`;

                                    return (
                                        <path
                                            key={index}
                                            d={path}
                                            fill={colors[index % colors.length]}
                                            stroke="white"
                                            strokeWidth="0.5"
                                        />
                                    );
                                })}
                                {/* Small white circle in center for cleaner look */}
                                <circle cx="16" cy="16" r="3" fill="white" />
                            </svg>

                            {/* Legend */}
                            <div className="flex flex-col items-start space-y-2 mt-4">
                                {data.chartData.map((item, index) => (
                                    <div key={index} className="flex items-center">
                                        <span className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: colors[index % colors.length] }}></span>
                                        <span className="text-gray-700 font-medium">{item.label}: {item.value}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            }
            return <div key={id} className={`${baseClasses} p-4 bg-red-100 text-red-700`}>Unsupported Chart Type: {data.chartType}</div>;

        default:
            return <div key={id} className={`${baseClasses} p-4 bg-red-100 text-red-700`}>Unsupported Block Type: {type}</div>;
    }
};

// --- 5. FIELD RENDERING FOR REGISTRATION FORM ---

const FieldRenderer = ({ field, value, onChange, error }) => {
    const commonClasses = "w-full p-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 transition duration-150 shadow-inner";

    // Utility for Star/Heart Rating
    const RatingIcons = ({ type, count, isSelected, onSelect }) => {
        const Icon = type === 'StarRating' ? Star : Heart;
        return (
            <div className="flex space-x-1">
                {[...Array(5)].map((_, i) => (
                    <Icon
                        key={i}
                        className={`w-8 h-8 cursor-pointer transition-colors duration-200 ${i < count ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300'} ${isSelected && 'hover:text-yellow-400 hover:fill-yellow-400'}`}
                        onClick={() => onSelect(i + 1)}
                        fill={i < count ? 'currentColor' : 'none'}
                    />
                ))}
            </div>
        );
    };

    // Signature Canvas Component 
    const SignatureCanvas = ({ value, onChange }) => {
        const canvasRef = useRef(null);
        const [isDrawing, setIsDrawing] = useState(false);
        const [showControls, setShowControls] = useState(true);

        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.strokeStyle = INDIGO;

            if (value && value.startsWith('data:image/png')) {
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    setShowControls(false);
                };
                img.src = value;
            }
        }, [value]);

        const getCoords = (e) => {
            const rect = canvasRef.current.getBoundingClientRect();
            if (e.touches && e.touches.length > 0) {
                return {
                    x: e.touches[0].clientX - rect.left,
                    y: e.touches[0].clientY - rect.top,
                };
            }
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            };
        };

        const startDrawing = (e) => {
            e.preventDefault();
            setIsDrawing(true);
            setShowControls(true);
            const ctx = canvasRef.current.getContext('2d');
            const { x, y } = getCoords(e);
            ctx.beginPath();
            ctx.moveTo(x, y);
        };

        const draw = (e) => {
            if (!isDrawing) return;
            e.preventDefault();
            const ctx = canvasRef.current.getContext('2d');
            const { x, y } = getCoords(e);
            ctx.lineTo(x, y);
            ctx.stroke();
        };

        const stopDrawing = () => {
            if (!isDrawing) return;
            setIsDrawing(false);
            const canvas = canvasRef.current;
            onChange(canvas.toDataURL('image/png'));
            setShowControls(false);
        };

        const clearCanvas = () => {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            onChange('');
            setShowControls(true);
        };

        return (
            <div className="border border-gray-300 rounded-lg shadow-md p-2 bg-gray-50">
                <canvas
                    ref={canvasRef}
                    width={500}
                    height={200}
                    className="w-full h-48 bg-white rounded-md cursor-crosshair"
                    onMouseDown={startDrawing}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onMouseMove={draw}
                    onTouchStart={startDrawing}
                    onTouchEnd={stopDrawing}
                    onTouchCancel={stopDrawing}
                    onTouchMove={draw}
                />
                <div className="mt-2 flex justify-end">
                    <button
                        type="button"
                        onClick={clearCanvas}
                        className="text-sm px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition"
                    >
                        <Trash2 className="w-4 h-4 inline mr-1" /> Clear Signature
                    </button>
                </div>
                {showControls && <p className="text-center mt-2 text-sm text-gray-500">Draw your signature above using mouse or touch.</p>}
            </div>
        );
    };


    // Component Rendering (Field Renderer content remains the same, shortened for brevity)
    let inputField;
    const commonProps = {
        id: field.id,
        name: field.id,
        value: value || '',
        onChange: (e) => onChange(e.target.value),
        placeholder: field.placeholder || `Enter ${field.label}...`,
        className: commonClasses + (error ? ' border-red-500' : ' border-gray-300'),
        required: field.required,
    };

    switch (field.type) {
        case 'ShortAnswer':
        case 'FullName':
        case 'Address':
            inputField = <input type="text" {...commonProps} />;
            break;

        case 'EmailAddress':
            inputField = <input type="email" {...commonProps} />;
            break;

        case 'PhoneNumber':
            inputField = <input type="tel" {...commonProps} />;
            break;

        case 'LongAnswer':
            inputField = <textarea rows="4" {...commonProps} />;
            break;

        case 'MultipleChoice':
            inputField = (
                <div className="space-y-2">
                    {field.options?.map((option, index) => (
                        <label key={index} className="flex items-center p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-indigo-50 transition duration-150 shadow-sm">
                            <input
                                type="radio"
                                name={field.id}
                                value={option}
                                checked={value === option}
                                onChange={() => onChange(option)}
                                className="w-5 h-5 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                            />
                            <span className="ml-3 text-gray-700">{option}</span>
                        </label>
                    ))}
                </div>
            );
            break;

        case 'Checkboxes':
            inputField = (
                <div className="space-y-2">
                    {field.options?.map((option, index) => (
                        <label key={index} className="flex items-center p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-indigo-50 transition duration-150 shadow-sm">
                            <input
                                type="checkbox"
                                name={field.id}
                                value={option}
                                checked={Array.isArray(value) && value.includes(option)}
                                onChange={(e) => {
                                    const newValue = Array.isArray(value) ? [...value] : [];
                                    if (e.target.checked) {
                                        onChange([...newValue, option]);
                                    } else {
                                        onChange(newValue.filter(v => v !== option));
                                    }
                                }}
                                className="w-5 h-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                            />
                            <span className="ml-3 text-gray-700">{option}</span>
                        </label>
                    ))}
                </div>
            );
            break;

        case 'Dropdown':
        case 'Yes/No':
        case 'LikertScale':
            const options = field.options || (field.type === 'Yes/No' ? ['Yes', 'No'] : (field.type === 'LikertScale' ? ['Strongly Agree', 'Agree', 'Neutral', 'Disagree', 'Strongly Disagree'] : []));
            inputField = (
                <select {...commonProps} value={value || ''}>
                    <option value="" disabled>{field.placeholder || 'Select an option'}</option>
                    {options.map((option, index) => (
                        <option key={index} value={option}>{option}</option>
                    ))}
                </select>
            );
            break;

        case 'Ranking':
            // Ranking simulation: Display options, let user select order (simple approach)
            inputField = (
                <div className="space-y-2 p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">Please rank the following items by clicking them in order of preference:</p>
                    <div className="flex flex-wrap gap-2">
                        {field.options?.map((option, index) => (
                            <button
                                key={index}
                                type="button"
                                onClick={() => {
                                    const newValue = Array.isArray(value) ? [...value] : [];
                                    if (newValue.includes(option)) {
                                        onChange(newValue.filter(v => v !== option)); // Remove
                                    } else if (newValue.length < field.options.length) {
                                        onChange([...newValue, option]); // Add
                                    }
                                }}
                                className={`px-4 py-2 text-sm font-medium rounded-full transition duration-150 ${
                                    Array.isArray(value) && value.includes(option)
                                        ? 'bg-emerald-500 text-white shadow-md'
                                        : 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-50'
                                }`}
                            >
                                {Array.isArray(value) && value.includes(option) && (
                                    <span className="mr-1 font-bold">{value.indexOf(option) + 1}.</span>
                                )}
                                {option}
                            </button>
                        ))}
                    </div>
                    {Array.isArray(value) && value.length > 0 && (
                        <p className="mt-2 text-sm text-indigo-600">Current Rank: {value.map((v, i) => `${i + 1}. ${v}`).join(' / ')}</p>
                    )}
                </div>
            );
            break;

        case 'LinearScale':
        case 'Slider':
            const min = field.min || 0;
            const max = field.max || 100;
            const step = field.step || 1;
            const displayValue = value === 0 || value ? value : min;

            inputField = (
                <div className="p-4 bg-gray-50 rounded-lg shadow-inner">
                    <div className="flex justify-between font-bold text-gray-700 mb-2">
                        <span>{displayValue}</span>
                        <div className="text-sm text-gray-500 flex items-center">
                            Min: <span className="ml-1 font-bold text-indigo-600">{min}</span> | Max: <span className="ml-1 font-bold text-indigo-600">{max}</span>
                        </div>
                    </div>
                    <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={displayValue}
                        onChange={(e) => onChange(Number(e.target.value))}
                        className="w-full h-2 bg-indigo-200 rounded-lg appearance-none cursor-pointer range-lg [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
                    />
                </div>
            );
            break;

        case 'StarRating':
        case 'HeartRating':
            inputField = (
                <RatingIcons
                    type={field.type}
                    count={Number(value) || 0}
                    onSelect={(count) => onChange(count)}
                    isSelected={true}
                />
            );
            break;

        case 'NumberField':
            inputField = <input type="number" {...commonProps} value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} />;
            break;

        case 'DatePicker':
            inputField = <input type="date" {...commonProps} value={value || ''} />;
            break;

        case 'TimeField':
            inputField = <input type="time" {...commonProps} value={value || ''} />;
            break;

        case 'FileUpload':
            inputField = (
                <input
                    type="file"
                    accept=".pdf,.png,.jpeg,.jpg"
                    onChange={(e) => {
                        const file = e.target.files[0];
                        if (file) {
                            onChange(`(File Upload: ${file.name}, ${file.size} bytes)`);
                            // In a real app, this would upload to Cloud Storage and save the URL.
                        }
                    }}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                />
            );
            break;

        case 'Signature':
            inputField = <SignatureCanvas value={value} onChange={onChange} />;
            break;

        case 'ImageDisplay':
        case 'VideoDisplay':
        case 'Instructions':
            inputField = (
                <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl shadow-inner">
                    {field.type === 'Instructions' && (
                        <div className="prose max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: field.content }}></div>
                    )}
                    {field.type === 'ImageDisplay' && (
                        <img src={field.imageUrl || 'https://placehold.co/400x200/525252/ffffff?text=Image+Display'} alt="Display" className="rounded-lg w-full h-auto object-cover shadow-md" />
                    )}
                    {field.type === 'VideoDisplay' && (
                        <div className="relative pt-[56.25%] rounded-lg overflow-hidden shadow-md">
                            <iframe className="absolute top-0 left-0 w-full h-full" src={field.url} title="Video" frameBorder="0" allowFullScreen></iframe>
                        </div>
                    )}
                </div>
            );
            break;

        case 'ImageQuestion':
            // Custom field type rendering
            inputField = (
                <div className="space-y-4 p-4 bg-gray-50 rounded-xl shadow-inner">
                    <img src={field.imageUrl || 'https://placehold.co/400x200/525252/ffffff?text=Image+Prompt'} alt="Question Prompt" className="rounded-lg w-full h-auto object-cover shadow-md" />

                    <label className="block text-sm font-medium text-gray-700 mt-4">Select the correct option(s):</label>
                    <div className="space-y-2">
                        {field.options?.map((option, index) => (
                            <label key={index} className="flex items-center p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-indigo-100 transition duration-150">
                                <input
                                    type="checkbox"
                                    name={`${field.id}_checkbox`}
                                    checked={Array.isArray(value?.selection) && value.selection.includes(option)}
                                    onChange={(e) => {
                                        const selection = Array.isArray(value?.selection) ? [...value.selection] : [];
                                        if (e.target.checked) {
                                            onChange({ ...value, selection: [...selection, option] });
                                        } else {
                                            onChange({ ...value, selection: selection.filter(v => v !== option) });
                                        }
                                    }}
                                    className="w-5 h-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                />
                                <span className="ml-3 text-gray-700">{option}</span>
                            </label>
                        ))}
                    </div>

                    {field.optionalLongText && (
                        <div className="mt-4">
                            <label htmlFor={`${field.id}_text`} className="block text-sm font-medium text-gray-700">Optional Explanation:</label>
                            <textarea
                                id={`${field.id}_text`}
                                rows="3"
                                value={value?.explanation || ''}
                                onChange={(e) => onChange({ ...value, explanation: e.target.value })}
                                className={commonClasses + ' mt-1'}
                                placeholder="Provide your optional explanation here..."
                            />
                        </div>
                    )}
                </div>
            );
            break;

        default:
            inputField = <div className="p-4 bg-red-100 text-red-700 rounded-lg">Unsupported Field Type: {field.type}</div>;
            break;
    }

    if (field.type === 'Instructions' || field.type === 'ImageDisplay' || field.type === 'VideoDisplay') {
        return (
            <div className="mb-6">
                {inputField}
            </div>
        );
    }

    return (
        <div className="mb-6">
            <label htmlFor={field.id} className="block text-lg font-medium text-gray-700 mb-2 flex items-center">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            {inputField}
            {error && <p className="mt-2 text-sm text-red-600 flex items-center"><Info className="w-4 h-4 mr-1" />{error}</p>}
        </div>
    );
};


// --- 6. PAGE COMPONENTS ---

const Header = ({ navigate, isAdmin, logout, path }) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const navItems = [
        { name: 'Home', path: '/home', icon: Home, isVisible: true },
        { name: 'Register', path: '/register', icon: FileText, isVisible: path !== '/register' && path !== '/thank-you' },
        { name: 'Dashboard', path: '/dashboard/content', icon: Layout, isVisible: isAdmin },
    ].filter(item => item.isVisible);

    return (
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md shadow-lg transition-all duration-300">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-20">
                    <div className="flex-shrink-0">
                        <h1 className="text-3xl font-extrabold text-indigo-700 cursor-pointer" onClick={() => navigate('/home')}>
                            Islamic University Earth Club
                        </h1>
                    </div>

                    <nav className="hidden md:flex space-x-8 items-center">
                        {navItems.map((item) => (
                            <a
                                key={item.path}
                                href={`#${item.path}`}
                                onClick={() => navigate(item.path)}
                                className={`text-lg font-medium transition duration-150 transform hover:text-indigo-600 hover:scale-[1.05] ${path.startsWith(item.path) ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}
                            >
                                {item.name}
                            </a>
                        ))}
                        {isAdmin && (
                            <button
                                onClick={logout}
                                className="flex items-center text-red-500 hover:text-red-700 transition duration-150 ml-4 p-2 rounded-lg bg-red-50 hover:bg-red-100"
                            >
                                <LogOut className="w-5 h-5 mr-1" />
                                Admin Logout
                            </button>
                        )}
                        {!isAdmin && !['/dashboard/login'].includes(path) && (
                            <button
                                onClick={() => navigate('/dashboard/login')}
                                className="flex items-center text-indigo-500 hover:text-indigo-700 transition duration-150 ml-4 p-2 rounded-lg bg-indigo-50 hover:bg-indigo-100"
                            >
                                <LogIn className="w-5 h-5 mr-1" />
                                Admin Login
                            </button>
                        )}
                    </nav>

                    <button className="md:hidden" onClick={() => setIsMenuOpen(!isMenuOpen)}>
                        {isMenuOpen ? <X className="w-6 h-6 text-indigo-700" /> : <Menu className="w-6 h-6 text-indigo-700" />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {isMenuOpen && (
                <div className="md:hidden bg-white shadow-xl absolute w-full transition-all duration-300 ease-in-out border-t border-gray-100">
                    <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
                        {navItems.map((item) => (
                            <a
                                key={item.path}
                                href={`#${item.path}`}
                                onClick={() => { navigate(item.path); setIsMenuOpen(false); }}
                                className={`flex items-center px-3 py-2 rounded-md text-base font-medium ${path.startsWith(item.path) ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-50 hover:text-indigo-600'}`}
                            >
                                <item.icon className="w-5 h-5 mr-3" />
                                {item.name}
                            </a>
                        ))}
                    </div>
                    <div className="py-4 px-5 border-t border-gray-100">
                        {isAdmin ? (
                            <button
                                onClick={() => { logout(); setIsMenuOpen(false); }}
                                className="w-full flex items-center justify-center px-4 py-2 border border-red-300 rounded-md text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition"
                            >
                                <LogOut className="w-5 h-5 mr-2" />
                                Admin Logout
                            </button>
                        ) : (
                            !['/dashboard/login'].includes(path) && (
                                <button
                                    onClick={() => { navigate('/dashboard/login'); setIsMenuOpen(false); }}
                                    className="w-full flex items-center justify-center px-4 py-2 border border-indigo-300 rounded-md text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition"
                                >
                                    <LogIn className="w-5 h-5 mr-2" />
                                    Admin Login
                                </button>
                            )
                        )}
                    </div>
                </div>
            )}
        </header>
    );
};

// --- 6.1 Public Pages ---

const CodeValidationGate = ({ onValidationSuccess, codeValue, setCodeValue, codeError, setCodeError }) => {
    const { db } = React.useContext(AppContext);
    const [submissionStatus, setSubmissionStatus] = useState('idle'); // 'idle', 'validating_code', 'error'

    const handleValidate = async () => {
        if (!db) {
            setCodeError("Database connection error. Please try again.");
            setSubmissionStatus('idle');
            return;
        }

        setSubmissionStatus('validating_code');
        setCodeError(null);

        if (!codeValue.trim()) {
            setCodeError("Invitation code cannot be empty.");
            setSubmissionStatus('idle');
            return;
        }

        try {
            const q = query(collection(db, COL_INVITE_CODES), where("code", "==", codeValue.trim().toUpperCase()));
            const codeSnapshot = await getDocs(q);

            if (codeSnapshot.empty) {
                throw new Error("Invalid or expired invitation code.");
            }

            const codeDoc = codeSnapshot.docs[0];
            const codeData = codeDoc.data();

            if (codeData.used) {
                throw new Error("This invitation code has already been used.");
            }
            
            // Validation successful! Pass the code ID up to the parent component.
            onValidationSuccess(codeDoc.id, codeValue.trim().toUpperCase());

        } catch (error) {
            console.error("Code Validation Error:", error);
            setSubmissionStatus('idle'); // Change status back to idle/error state
            setCodeError(error.message || "An unexpected error occurred during validation.");
        }
    };

    return (
        <div className="text-center py-10 bg-indigo-50 border border-indigo-200 rounded-xl shadow-lg">
            <Key className="w-12 h-12 text-indigo-600 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-gray-800 mb-4">IUEC Membership Invitation</h2>
            <p className="text-gray-600 mb-6">Please enter your official club invitation code to start registration.</p>

            <div className="max-w-sm mx-auto">
                <input
                    type="text"
                    className={`w-full p-4 text-center text-xl font-mono tracking-widest border-2 rounded-xl focus:ring-4 focus:ring-emerald-500 transition duration-150 shadow-lg ${codeError ? 'border-red-500' : 'border-gray-300'}`}
                    value={codeValue}
                    onChange={(e) => setCodeValue(e.target.value.toUpperCase())}
                    placeholder="E.g., IUEC-A1B2C3"
                    disabled={submissionStatus === 'validating_code'}
                />
                {codeError && <p className="mt-3 text-red-600 text-sm font-medium flex items-center justify-center"><Info className="w-4 h-4 mr-1" />{codeError}</p>}
            </div>

            <button
                onClick={handleValidate}
                disabled={submissionStatus === 'validating_code' || !codeValue.trim()}
                className="mt-8 px-8 py-4 text-lg font-semibold text-white bg-indigo-600 rounded-full shadow-xl hover:bg-indigo-700 transition duration-300 transform hover:scale-[1.05] disabled:bg-gray-400 flex items-center justify-center mx-auto"
            >
                {submissionStatus === 'validating_code' && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
                Validate Invitation Code
            </button>
        </div>
    );
};

const HomePage = ({ navigate }) => {
    const { db } = React.useContext(AppContext);
    const [contentBlocks, setContentBlocks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!db) return;

        const unsub = onSnapshot(doc(db, DOC_CONTENT_BUILDER), (docSnap) => {
            if (docSnap.exists() && docSnap.data().published) {
                const blocks = docSnap.data().published.sort((a, b) => a.order - b.order);
                setContentBlocks(blocks);
            } else {
                setContentBlocks([]);
            }
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching homepage content:", error);
            setIsLoading(false);
        });

        return () => unsub();
    }, [db]);

    if (isLoading) return <LoadingScreen />;

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <main className="min-h-screen pt-4 pb-16">
                {contentBlocks.length === 0 ? (
                    <Card title="Welcome" className="text-center py-20">
                        <p className="text-gray-600">No published content found. Admin needs to use the Visual Page Builder to publish content.</p>
                        <button
                            onClick={() => navigate('/dashboard/content')}
                            className="mt-6 px-6 py-3 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition duration-300 shadow-md"
                        >
                            Go to Content Builder
                        </button>
                    </Card>
                ) : (
                    contentBlocks.map(block => renderBlock(block, navigate))
                )}
            </main>
        </div>
    );
};

const ThankYouPage = () => {
    const { navigate } = useRoute();
    return (
        <div className="flex items-center justify-center min-h-screen bg-indigo-50">
            <Card className="max-w-2xl text-center py-12 px-10 shadow-2xl border-t-8 border-emerald-500">
                <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-6 animate-pulse" />
                <h1 className="text-4xl font-extrabold text-gray-800 mb-4">Thank You for Joining!</h1>
                <p className="text-xl text-gray-600 mb-6">
                    Congratulations! Your membership in the **Islamic University Earth Club (IUEC)** is confirmed.
                </p>
                <p className="text-lg text-gray-700">
                    Your commitment to sustainability is vital. Clear next steps:
                    <ul className="list-disc list-inside text-left mt-4 mx-auto max-w-sm space-y-2">
                        <li>You will receive a welcome email with your member ID shortly.</li>
                        <li>Join our Telegram group (link in welcome email) for immediate event updates.</li>
                        <li>Attend the next orientation session on campus (details on the club notice board).</li>
                    </ul>
                </p>
                <button
                    onClick={() => navigate('/home')}
                    className="mt-8 px-8 py-3 text-lg font-semibold text-white bg-indigo-600 rounded-full shadow-lg hover:bg-indigo-700 transition duration-300 transform hover:scale-[1.02]"
                >
                    Return to Homepage
                </button>
            </Card>
        </div>
    );
};

const RegisterPage = ({ navigate }) => {
    const { db } = React.useContext(AppContext);
    const [formStructure, setFormStructure] = useState(null);
    const [formData, setFormData] = useState({});
    const [currentStep, setCurrentStep] = useState(0);
    const [errors, setErrors] = useState({});
    const [isFormLoading, setIsFormLoading] = useState(true);
    
    // New state to manage the two phases of registration
    const [phase, setPhase] = useState('code_validation'); // 'code_validation', 'form_filling', 'final_submit'
    const [inviteCodeId, setInviteCodeId] = useState(null);
    const [inviteCodeValue, setInviteCodeValue] = useState(null);
    const [codeValue, setCodeValue] = useState('');
    const [codeError, setCodeError] = useState(null);

    useEffect(() => {
        if (!db) return;
        const unsub = onSnapshot(doc(db, DOC_FORM_STRUCTURE), (docSnap) => {
            if (docSnap.exists()) {
                setFormStructure(docSnap.data());
                // Initialize formData with default empty arrays for checkboxes/ranking
                const initialData = {};
                docSnap.data().segments.forEach(segment => {
                    segment.fields.forEach(field => {
                        if (field.type === 'Checkboxes' || field.type === 'Ranking') {
                            initialData[field.id] = [];
                        } else if (field.type === 'ImageQuestion') {
                             initialData[field.id] = { selection: [], explanation: '' };
                        }
                    });
                });
                setFormData(prev => ({...initialData, ...prev}));
            }
            setIsFormLoading(false);
        }, (error) => {
            console.error("Error fetching form structure:", error);
            setIsFormLoading(false);
        });

        return () => unsub();
    }, [db]);

    const segments = formStructure?.segments || [];
    const currentSegment = segments[currentStep];

    const handleCodeValidationSuccess = (codeId, codeValue) => {
        setInviteCodeId(codeId);
        setInviteCodeValue(codeValue);
        setPhase('form_filling');
        setCurrentStep(0); // Start the form filling process
        setCodeError(null);
    };

    const validateStep = () => {
        if (!currentSegment || phase !== 'form_filling') return true;

        const currentErrors = {};
        let isValid = true;

        currentSegment.fields.forEach(field => {
            if (field.required) {
                const value = formData[field.id];
                let fieldError = null;

                if (
                    !value ||
                    (typeof value === 'string' && value.trim() === '') ||
                    (Array.isArray(value) && value.length === 0) ||
                    (field.type === 'ImageQuestion' && (!value.selection || value.selection.length === 0))
                ) {
                    fieldError = `${field.label} is required.`;
                    isValid = false;
                } else if (field.type === 'EmailAddress' && !/\S+@\S+\.\S+/.test(value)) {
                    fieldError = 'Please enter a valid email address.';
                    isValid = false;
                }
                currentErrors[field.id] = fieldError;
            }
        });

        setErrors(prev => ({ ...prev, ...currentErrors }));
        return isValid;
    };

    const handleNext = () => {
        if (phase === 'code_validation') return;

        if (validateStep()) {
            if (currentStep < segments.length - 1) {
                setCurrentStep(currentStep + 1);
                setErrors({});
            } else {
                // Final form step reached, proceed to final submission logic
                handleSubmission(); 
            }
        }
    };
    
    // Unified submission handler (Handles both final form validation and actual save)
    const handleSubmission = async () => {
         if (isFinalStep) {
            // Perform actual database submission
            const submissionButton = document.getElementById('final-submit-button');
            if (submissionButton) submissionButton.disabled = true;

            try {
                await runTransaction(db, async (transaction) => {
                    // This block relies on inviteCodeId and inviteCodeValue already being set by CodeValidationGate
                    if (!inviteCodeId) throw new Error("Internal error: Invitation code details missing.");

                    const codeRef = doc(db, COL_INVITE_CODES, inviteCodeId);
                    const codeDoc = await transaction.get(codeRef);

                    if (!codeDoc.exists() || codeDoc.data().used) {
                        throw new Error("The invitation code status changed. Please restart the process.");
                    }

                    // 1. Save Submission
                    const submissionRef = doc(collection(db, COL_SUBMISSIONS));
                    const submissionData = {
                        name: formData[segments[0].fields.find(f => f.type === 'FullName')?.id] || 'N/A',
                        email: formData[segments[0].fields.find(f => f.type === 'EmailAddress')?.id] || 'N/A',
                        submissionDate: new Date(),
                        inviteCode: inviteCodeId, // Store Code Doc ID
                        inviteCodeValue: inviteCodeValue,
                        answers: formData,
                    };
                    transaction.set(submissionRef, submissionData);

                    // 2. Mark Code as Used
                    transaction.update(codeRef, {
                        used: true,
                        usedBySubmissionId: submissionRef.id,
                    });
                });

                // Transaction succeeded
                navigate('/thank-you');

            } catch (error) {
                console.error("Submission Error:", error);
                alert(`Submission Failed: ${error.message}`); 
            } finally {
                if (submissionButton) submissionButton.disabled = false;
            }
        } else {
             // If this is called prematurely (shouldn't happen with fixed navigation)
             console.error("Attempted submission before final step.");
        }
    }


    const handleBack = () => {
        if (phase === 'form_filling' && currentStep > 0) {
            setCurrentStep(currentStep - 1);
            setErrors({});
        } else if (phase === 'form_filling' && currentStep === 0) {
             // From first step of form, go back to code validation
            setPhase('code_validation');
            setInviteCodeId(null);
            setInviteCodeValue(null);
            setErrors({});
        } 
    };

    const handleInputChange = (fieldId, value) => {
        setFormData(prev => ({ ...prev, [fieldId]: value }));
        if (errors[fieldId]) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[fieldId];
                return newErrors;
            });
        }
    };


    if (isFormLoading) return <LoadingScreen />;
    if (!formStructure || segments.length === 0) return <Card className="max-w-2xl mx-auto my-12 text-center">Form structure not available. Please check Admin FileText Builder.</Card>;

    // --- Phase 1: Code Validation ---
    if (phase === 'code_validation') {
        return (
            <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <Card title="IUEC Membership Registration" icon={Users} className="border-t-4 border-indigo-600">
                    <CodeValidationGate 
                        onValidationSuccess={handleCodeValidationSuccess}
                        codeValue={codeValue}
                        setCodeValue={setCodeValue}
                        codeError={codeError}
                        setCodeError={setCodeError}
                    />
                </Card>
            </div>
        );
    }
    
    // --- Phase 2 & 3: Form Filling / Review ---
    const progress = Math.round((currentStep + 1) / segments.length * 100);
    const isFinalStep = currentStep === segments.length - 1;

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <Card title="IUEC Membership Registration" icon={Users} className="border-t-4 border-indigo-600">
                {/* Progress Bar */}
                <div className="mb-8">
                    <div className="text-sm font-medium text-gray-700 mb-2 flex justify-between">
                        <span>Step {currentStep + 1} of {segments.length}</span>
                        <span>{progress}% Complete</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5 shadow-inner">
                        <div
                            className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                </div>

                {/* Current Segment Content */}
                {currentSegment && (
                    <>
                        <h2 className="text-2xl font-bold text-indigo-700 mb-6 border-b pb-2">{currentSegment.title}</h2>
                        {currentSegment.fields.map(field => (
                            <FieldRenderer
                                key={field.id}
                                field={field}
                                value={formData[field.id]}
                                onChange={(value) => handleInputChange(field.id, value)}
                                error={errors[field.id]}
                            />
                        ))}
                    </>
                )}

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-10 border-t pt-6">
                    <button
                        onClick={handleBack}
                        className="flex items-center px-6 py-3 text-lg font-medium text-indigo-600 bg-indigo-50 rounded-full hover:bg-indigo-100 transition duration-300 shadow-md"
                    >
                        <ChevronLeft className="w-5 h-5 mr-2" />
                        Back
                    </button>

                    {!isFinalStep && (
                        <button
                            onClick={handleNext}
                            className="flex items-center px-6 py-3 text-lg font-semibold text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition duration-300 shadow-xl transform hover:scale-[1.02]"
                        >
                            Next Step
                            <ChevronRight className="w-5 h-5 ml-2" />
                        </button>
                    )}

                    {isFinalStep && (
                        <button
                            onClick={handleNext} // Calls handleNext which calls handleSubmission if validation passes
                            id="final-submit-button"
                            className="flex items-center px-6 py-3 text-lg font-semibold text-white bg-emerald-500 rounded-full hover:bg-emerald-600 transition duration-300 shadow-xl transform hover:scale-[1.02]"
                        >
                            Submit Application
                            <CheckCircle className="w-5 h-5 ml-2" />
                        </button>
                    )}
                </div>

            </Card>
        </div>
    );
};

// --- 6.2 Admin Pages ---

const AdminLogin = ({ navigate, login, error, setError, isLoading }) => {
    // FIX 2: Set initial state to empty strings to require manual typing
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        // Uses the fixed ADMIN_EMAIL/PASSWORD for the local bypass check
        const result = await login(email, password);
        
        if (result.success) {
            navigate('/dashboard/content');
        } else {
            setError('Login Failed. Check credentials.');
        }
        setIsSubmitting(false);
    };

    if (isLoading) return <LoadingScreen />;

    return (
        <div className="flex items-center justify-center min-h-screen bg-indigo-50">
            <Card title="Admin Login" icon={LogIn} className="max-w-md w-full border-t-8 border-indigo-600">
                {/* FIX 1: Removed Demo Mode text entirely as requested */}
                
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Email Address</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="Enter Email Address" // FIX 2: Placeholder text, not actual value
                            className="mt-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="Enter Password" // FIX 2: Placeholder text, not actual value
                            className="mt-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                        />
                    </div>
                    {error && <div className="p-3 text-sm font-medium text-red-700 bg-red-100 rounded-lg">{error}</div>}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-full shadow-lg text-white bg-indigo-600 hover:bg-indigo-700 transition duration-300 disabled:bg-gray-400"
                    >
                        {isSubmitting && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
                        Sign In
                    </button>
                </form>
            </Card>
        </div>
    );
};

const AdminDashboardHeader = ({ navigate }) => (
    <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-md mb-6 border-b-2 border-indigo-100 sticky top-0 z-10">
        <h1 className="text-2xl font-extrabold text-indigo-700">Admin Dashboard</h1>
        <div className="space-x-3 flex items-center">
            <button
                onClick={() => navigate('/home')}
                className="flex items-center px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition"
            >
                <Home className="w-4 h-4 mr-2" /> Go to Homepage
            </button>
            <button
                onClick={() => navigate('/register')}
                className="flex items-center px-4 py-2 text-sm bg-emerald-100 text-emerald-700 rounded-full hover:bg-emerald-200 transition"
            >
                <Eye className="w-4 h-4 mr-2" /> Preview Form
            </button>
        </div>
    </div>
);


const AdminLayout = ({ children, navigate, path }) => {
    const { isAdmin, logout, user, isLoading } = React.useContext(AppContext);
    
    if (isLoading) return <LoadingScreen />;

    if (!isAdmin) {
        // If not admin, force navigation back to the login page immediately.
        useEffect(() => navigate('/dashboard/login'), [navigate]);
        return null;
    }
    
    // Safety check for user details after successful login (especially demo login)
    const displayUserId = user?.email || user?.uid || 'N/A';

    const navItems = [
        { name: 'Page Builder', path: '/dashboard/content', icon: Layout },
        { name: 'Form Builder', path: '/dashboard/forms', icon: FileText },
        { name: 'Invite Codes', path: '/dashboard/codes', icon: Key },
        { name: 'Submissions', path: '/dashboard/submissions', icon: ClipboardList },
    ];

    return (
        <div className="flex min-h-screen bg-gray-50">
            {/* Sidebar */}
            <div className="w-64 bg-indigo-800 text-white p-6 shadow-2xl hidden lg:block sticky top-0 h-screen">
                <h2 className="text-2xl font-extrabold mb-8 border-b border-indigo-700 pb-4">Admin Console</h2>
                <nav className="space-y-2">
                    {navItems.map(item => (
                        <a
                            key={item.path}
                            href={`#${item.path}`}
                            onClick={() => navigate(item.path)}
                            className={`flex items-center p-3 rounded-xl transition duration-200 hover:bg-indigo-700 ${path.startsWith(item.path) ? 'bg-indigo-700 shadow-md text-emerald-300' : 'text-indigo-200'}`}
                        >
                            <item.icon className="w-5 h-5 mr-3" />
                            {item.name}
                        </a>
                    ))}
                    <button
                        onClick={logout}
                        className="flex items-center p-3 rounded-xl transition duration-200 hover:bg-red-700 w-full mt-4 text-red-300 bg-indigo-700"
                    >
                        <LogOut className="w-5 h-5 mr-3" />
                        Logout
                    </button>
                </nav>
                <div className="mt-8 pt-4 border-t border-indigo-700">
                     <p className="text-xs text-indigo-400">User: {displayUserId}</p>
                </div>
            </div>

            {/* Content Area */}
            <main className="flex-1 p-6 md:p-10">
                <AdminDashboardHeader navigate={navigate} />
                {children}
            </main>
        </div>
    );
};


const DashboardHome = () => (
    <Card title="Welcome, Admin" icon={Cpu} className="text-center py-20 bg-indigo-50 border-t-4 border-indigo-600">
        <p className="text-xl text-gray-600">Use the sidebar to manage site content, registration forms, invite codes, and submissions.</p>
    </Card>
);

// --- 6.2.1 Content Builder ---

const BlockEditorModal = ({ isOpen, onClose, block, onSave }) => {
    const [localData, setLocalData] = useState(block ? block.data : {});
    const [localTitle, setLocalTitle] = useState(block?.data?.title || '');
    const [tempStats, setTempStats] = useState(block?.data?.stats || []);
    const [tempChartData, setTempChartData] = useState(block?.data?.chartData || []);

    useEffect(() => {
        if (block) {
            setLocalData(block.data);
            setLocalTitle(block.data.title || '');
            setTempStats(block.data.stats || []);
            setTempChartData(block.data.chartData || []);
        }
    }, [block]);

    if (!block) return null;

    const handleDataChange = (key, value) => {
        setLocalData(prev => ({ ...prev, [key]: value }));
    };

    const handleStatChange = (index, key, value) => {
        const newStats = [...tempStats];
        newStats[index] = { ...newStats[index], [key]: value };
        setTempStats(newStats);
    };

    const handleChartChange = (index, key, value) => {
        const newData = [...tempChartData];
        newData[index] = { ...newData[index], [key]: key === 'value' ? Number(value) : value };
        setTempChartData(newData);
    };

    const handleSave = () => {
        let updatedData = localData;

        if (block.type === 'Stats/Counters') updatedData = { ...updatedData, stats: tempStats };
        if (block.type === 'ChartSimulation') updatedData = { ...updatedData, chartData: tempChartData, title: localTitle };
        if (block.type === 'HeroBanner') updatedData = { ...updatedData, title: localTitle };
        if (block.type === 'VideoEmbed') updatedData = { ...updatedData, title: localTitle };

        onSave({ ...block, data: updatedData });
        onClose();
    };

    const renderFields = () => {
        switch (block.type) {
            case 'HeroBanner':
                return (
                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-gray-700">Title</label>
                        <input type="text" className="w-full p-2 border rounded-lg" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} />
                        <label className="block text-sm font-medium text-gray-700">Subtitle</label>
                        <input type="text" className="w-full p-2 border rounded-lg" value={localData.subtitle || ''} onChange={(e) => handleDataChange('subtitle', e.target.value)} />
                        <label className="block text-sm font-medium text-gray-700">CTA Text</label>
                        <input type="text" className="w-full p-2 border rounded-lg" value={localData.ctaText || ''} onChange={(e) => handleDataChange('ctaText', e.target.value)} />
                        <label className="block text-sm font-medium text-gray-700">CTA Link (e.g., #/register)</label>
                        <input type="text" className="w-full p-2 border rounded-lg" value={localData.ctaLink || ''} onChange={(e) => handleDataChange('ctaLink', e.target.value)} />
                    </div>
                );
            case 'RichText':
                return (
                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-gray-700">Content (HTML Supported)</label>
                        <textarea rows="8" className="w-full p-2 border rounded-lg font-mono text-sm" value={localData.content || ''} onChange={(e) => handleDataChange('content', e.target.value)} />
                        <p className="text-xs text-gray-500">Note: Basic HTML tags like &lt;p&gt;, &lt;strong&gt;, &lt;ul&gt; are supported.</p>
                    </div>
                );
            case 'Stats/Counters':
                return (
                    <div className="space-y-4">
                        <h4 className="font-semibold text-indigo-600">Statistics List</h4>
                        {tempStats.map((stat, index) => (
                            <Card key={index} className="p-4 border border-gray-100 shadow-sm relative">
                                <button onClick={() => setTempStats(tempStats.filter((_, i) => i !== index))} className="absolute top-2 right-2 text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                                <label className="block text-sm font-medium text-gray-700">Label</label>
                                <input type="text" className="w-full p-1 border rounded-lg mb-2" value={stat.label || ''} onChange={(e) => handleStatChange(index, 'label', e.target.value)} />
                                <label className="block text-sm font-medium text-gray-700">Value (Number)</label>
                                <input type="number" className="w-full p-1 border rounded-lg mb-2" value={stat.value || 0} onChange={(e) => handleStatChange(index, 'value', Number(e.target.value))} />
                                <label className="block text-sm font-medium text-gray-700">Icon Name (e.g., Users, TreePine)</label>
                                <input type="text" className="w-full p-1 border rounded-lg" value={stat.icon || ''} onChange={(e) => handleStatChange(index, 'icon', e.target.value)} />
                            </Card>
                        ))}
                        <button type="button" onClick={() => setTempStats([...tempStats, { label: '', value: 0, icon: 'Info' }])} className="w-full p-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition"><Plus className="w-4 h-4 inline mr-2" />Add Stat</button>
                    </div>
                );
            case 'VideoEmbed':
                return (
                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-gray-700">Title</label>
                        <input type="text" className="w-full p-2 border rounded-lg" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} />
                        <label className="block text-sm font-medium text-gray-700">YouTube or Video URL</label>
                        <input type="url" className="w-full p-2 border rounded-lg" value={localData.url || ''} onChange={(e) => handleDataChange('url', e.target.value)} />
                    </div>
                );
            case 'ChartSimulation':
                return (
                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-gray-700">Chart Title</label>
                        <input type="text" className="w-full p-2 border rounded-lg" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} />
                        <h4 className="font-semibold text-indigo-600">Chart Data Items (Total % should be 100)</h4>
                        {tempChartData.map((item, index) => (
                            <Card key={index} className="p-4 border border-gray-100 shadow-sm relative">
                                <button onClick={() => setTempChartData(tempChartData.filter((_, i) => i !== index))} className="absolute top-2 right-2 text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                                <label className="block text-sm font-medium text-gray-700">Label</label>
                                <input type="text" className="w-full p-1 border rounded-lg mb-2" value={item.label || ''} onChange={(e) => handleChartChange(index, 'label', e.target.value)} />
                                <label className="block text-sm font-medium text-gray-700">Value (Percentage %)</label>
                                <input type="number" className="w-full p-1 border rounded-lg" value={item.value || 0} onChange={(e) => handleChartChange(index, 'value', e.target.value)} />
                            </Card>
                        ))}
                        <button type="button" onClick={() => setTempChartData([...tempChartData, { label: '', value: 0 }])} className="w-full p-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition"><Plus className="w-4 h-4 inline mr-2" />Add Data Item</button>
                    </div>
                );
            default:
                return <p>No specific fields for this block type.</p>;
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit Block: ${block.type}`} size="lg">
            {renderFields()}
            <div className="mt-6 pt-4 border-t flex justify-end">
                <IconButton onClick={handleSave} Icon={Save} className="bg-emerald-500 hover:bg-emerald-600">Save Changes</IconButton>
            </div>
        </Modal>
    );
};

const ContentBuilder = () => {
    const { db } = React.useContext(AppContext);
    const [contentData, setContentData] = useState({ published: [], draft: [] });
    const [currentList, setCurrentList] = useState('draft'); // 'draft' or 'published'
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [editingBlock, setEditingBlock] = useState(null);
    const [statusMessage, setStatusMessage] = useState(null);

    const showStatus = (message, isError = false) => {
        setStatusMessage({ message, isError });
        setTimeout(() => setStatusMessage(null), 3000);
    };

    useEffect(() => {
        if (!db) return;

        const unsub = onSnapshot(doc(db, DOC_CONTENT_BUILDER), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setContentData({
                    published: data.published || [],
                    draft: data.draft || [],
                });
            }
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching content data:", error);
            showStatus("Error loading content.", true);
            setIsLoading(false);
        });

        return () => unsub();
    }, [db]);

    const handleReorder = (list, fromIndex, toIndex) => {
        const newBlocks = [...contentData[list]];
        const [movedBlock] = newBlocks.splice(fromIndex, 1);
        newBlocks.splice(toIndex, 0, movedBlock);

        // Update order property
        const updatedBlocks = newBlocks.map((block, index) => ({ ...block, order: index }));

        setContentData(prev => ({ ...prev, [list]: updatedBlocks }));
    };

    const handleSaveDraft = async () => {
        setIsSaving(true);
        try {
            await updateDoc(doc(db, DOC_CONTENT_BUILDER), { draft: contentData.draft });
            showStatus("Draft saved successfully!");
        } catch (error) {
            console.error("Error saving draft:", error);
            showStatus("Failed to save draft.", true);
        }
        setIsSaving(false);
    };

    const handlePublish = async () => {
        setIsSaving(true);
        try {
            // FIX: Ensure the published list receives the *current* draft content
            await updateDoc(doc(db, DOC_CONTENT_BUILDER), {
                published: contentData.draft,
                // Keep draft synchronized with published content after publish
                draft: contentData.draft, 
            });
            // Update local state to reflect the new published content immediately
            setContentData(prev => ({ published: prev.draft, draft: prev.draft }));
            showStatus("Page published successfully! New content is live.", false);
        } catch (error) {
            console.error("Error publishing page:", error);
            showStatus("Failed to publish page.", true);
        }
        setIsSaving(false);
    };

    const handleBlockUpdate = (updatedBlock) => {
        setContentData(prev => ({
            ...prev,
            [currentList]: prev[currentList].map(b => b.id === updatedBlock.id ? updatedBlock : b)
        }));
    };

    const handleBlockDelete = (blockId) => {
        setContentData(prev => ({
            ...prev,
            [currentList]: prev[currentList].filter(b => b.id !== blockId)
        }));
    };

    const addBlock = (type) => {
        const newBlock = {
            id: generateId('block'),
            type: type,
            order: contentData[currentList].length,
            data: {
                title: `${type} Block`,
                subtitle: 'New Subtitle',
                ctaText: 'Click Here',
                ctaLink: '#/register',
                content: '<p>New rich text content.</p>',
                stats: [{ icon: 'Info', value: 0, label: 'New Stat' }],
                chartData: [{ label: 'Item 1', value: 100 }],
                url: 'https://www.youtube.com/embed/dQw4w9WgXcQ?si=7l94n3Yt5jJ6h43s',
            }[type] || {},
        };
        setContentData(prev => ({ ...prev, [currentList]: [...prev[currentList], newBlock] }));
    };

    const blockTypes = [
        { type: 'HeroBanner', icon: Maximize },
        { type: 'RichText', icon: MessageSquare },
        { type: 'Stats/Counters', icon: TrendingUp },
        { type: 'VideoEmbed', icon: Film },
        { type: 'ChartSimulation', icon: BarChart3 },
    ];

    if (isLoading) return <LoadingScreen />;

    return (
        <>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800 flex items-center"><Layout className="w-7 h-7 mr-2 text-indigo-600" /> Visual Page Builder</h1>
                <div className="flex space-x-3">
                    <button
                        onClick={handleSaveDraft}
                        disabled={isSaving}
                        className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-full shadow-md hover:bg-indigo-700 transition duration-300 disabled:bg-gray-400"
                    >
                        {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                    </button>
                    <button
                        onClick={handlePublish}
                        disabled={isSaving}
                        className="flex items-center px-4 py-2 bg-emerald-500 text-white rounded-full shadow-md hover:bg-emerald-600 transition duration-300 disabled:bg-gray-400"
                    >
                        <Zap className="w-4 h-4 mr-2" />
                        Publish Page
                    </button>
                </div>
            </div>

            {statusMessage && (
                <div className={`mb-4 p-3 rounded-lg font-medium ${statusMessage.isError ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {statusMessage.message}
                </div>
            )}

            <div className="flex space-x-4 mb-6">
                <button
                    onClick={() => setCurrentList('draft')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${currentList === 'draft' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-50'}`}
                >
                    Draft Content
                </button>
                <button
                    onClick={() => setCurrentList('published')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${currentList === 'published' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-50'}`}
                >
                    Live (Published) Content
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Block Library - DND Simulation (Simple list) */}
                <Card title="Add Blocks" className="lg:col-span-1 h-fit sticky top-24 bg-gray-100">
                    <div className="space-y-3">
                        {blockTypes.map(block => (
                            <button
                                key={block.type}
                                onClick={() => addBlock(block.type)}
                                className="w-full flex items-center p-3 bg-white rounded-xl border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition duration-200 shadow-sm"
                            >
                                <block.icon className="w-5 h-5 mr-3" />
                                {block.type}
                            </button>
                        ))}
                    </div>
                </Card>

                {/* Content List Area - DND Simulation (Simple list reordering) */}
                <Card title={`${currentList === 'draft' ? 'Draft' : 'Published'} Page Layout`} className="lg:col-span-3 min-h-[500px] border-t-4 border-emerald-500">
                    <p className="text-sm text-gray-500 mb-4">Drag-and-drop items to reorder. Changes here must be saved to Draft, and then Published to go live.</p>
                    <div className="space-y-4">
                        {contentData[currentList].length === 0 ? (
                            <div className="text-center py-10 text-gray-500 border-dashed border-2 border-gray-300 rounded-xl">
                                Drag or add a block here.
                            </div>
                        ) : (
                            contentData[currentList].map((block, index) => (
                                <div
                                    key={block.id}
                                    className="p-4 bg-white border border-gray-200 rounded-xl shadow-lg transition duration-200 hover:shadow-xl cursor-grab active:cursor-grabbing"
                                    draggable
                                    onDragStart={(e) => e.dataTransfer.setData('text/plain', index)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                                        handleReorder(currentList, fromIndex, index);
                                    }}
                                >
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center">
                                            <ListOrdered className="w-5 h-5 mr-3 text-indigo-500" />
                                            <span className="font-semibold text-gray-800">{block.type} ({block.order + 1})</span>
                                            <span className="ml-3 text-sm text-gray-500 truncate max-w-[200px]">{block.data.title || block.data.content?.substring(0, 30) + '...'}</span>
                                        </div>
                                        <div className="flex space-x-2">
                                            <button onClick={() => setEditingBlock(block)} className="p-2 text-indigo-600 hover:bg-indigo-100 rounded-full transition"><Edit className="w-5 h-5" /></button>
                                            <button onClick={() => handleBlockDelete(block.id)} className="p-2 text-red-600 hover:bg-red-100 rounded-full transition"><Trash2 className="w-5 h-5" /></button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </Card>
            </div>

            <BlockEditorModal
                isOpen={!!editingBlock}
                onClose={() => setEditingBlock(null)}
                block={editingBlock}
                onSave={handleBlockUpdate}
            />
        </>
    );
};

// --- 6.2.2 Form Builder ---

const FieldTypeMap = {
    // Core Text
    ShortAnswer: { icon: Type, name: 'Short Answer', defaultOptions: null },
    LongAnswer: { icon: AlignJustify, name: 'Paragraph', defaultOptions: null },
    FullName: { icon: Users, name: 'Name / Full Name', defaultOptions: null },
    EmailAddress: { icon: Mail, name: 'Email Address', defaultOptions: null },
    PhoneNumber: { icon: Smartphone, name: 'Phone Number', defaultOptions: null },
    Address: { icon: Globe, name: 'Address', defaultOptions: null },
    // Choice
    MultipleChoice: { icon: Radio, name: 'Multiple Choice', defaultOptions: ['Option 1', 'Option 2'] },
    Checkboxes: { icon: CheckSquare, name: 'Checkboxes', defaultOptions: ['Option 1', 'Option 2'] },
    Dropdown: { icon: ListOrdered, name: 'Dropdown', defaultOptions: ['Option 1', 'Option 2'] },
    'Yes/No': { icon: HelpCircle, name: 'Yes / No', defaultOptions: ['Yes', 'No'] },
    Ranking: { icon: CornerDownRight, name: 'Ranking', defaultOptions: ['Item A', 'Item B', 'Item C'] },
    // Rating/Scales
    LinearScale: { icon: BarChart3, name: 'Linear Scale', defaultOptions: { min: 1, max: 5 } },
    'StarRating': { icon: Star, name: 'Star Rating', defaultOptions: { min: 1, max: 5 } },
    'HeartRating': { icon: Heart, name: 'Star Rating', defaultOptions: { min: 1, max: 5 } },
    LikertScale: { icon: ListOrdered, name: 'Likert Scale', defaultOptions: ['Strongly Agree', 'Agree', 'Neutral', 'Disagree', 'Strongly Disagree'] },
    Slider: { icon: Cpu, name: 'Slider', defaultOptions: { min: 0, max: 100 } },
    // Data/Upload
    NumberField: { icon: Hash, name: 'Number Field', defaultOptions: null },
    DatePicker: { icon: Calendar, name: 'Date Picker', defaultOptions: null },
    TimeField: { icon: Clock, name: 'Time Field', defaultOptions: null },
    FileUpload: { icon: Upload, name: 'File Upload', defaultOptions: null },
    Signature: { icon: BookOpen, name: 'Signature', defaultOptions: null },
    // Media/Special
    ImageDisplay: { icon: Dribbble, name: 'Image Display', defaultOptions: { imageUrl: 'https://placehold.co/400x100?text=Image+URL' } },
    VideoDisplay: { icon: Film, name: 'Video Display', defaultOptions: { url: 'https://www.youtube.com/embed/...' } },
    Instructions: { icon: Info, name: 'Instructions / Text Block', defaultOptions: { content: '<p>Enter instructions here.</p>' } },
    ImageQuestion: { icon: Maximize, name: 'Image Question (Special)', defaultOptions: { imageUrl: 'https://placehold.co/400x200?text=Image', options: ['Answer 1', 'Answer 2'], optionalLongText: false } },
};

const FormBuilder = () => {
    const { db } = React.useContext(AppContext);
    const [formStructure, setFormStructure] = useState({ segments: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
    const [selectedField, setSelectedField] = useState(null);
    const [statusMessage, setStatusMessage] = useState(null);

    const showStatus = (message, isError = false) => {
        setStatusMessage({ message, isError });
        setTimeout(() => setStatusMessage(null), 3000);
    };

    useEffect(() => {
        if (!db) return;

        const unsub = onSnapshot(doc(db, DOC_FORM_STRUCTURE), (docSnap) => {
            if (docSnap.exists()) {
                setFormStructure(docSnap.data());
                // Ensure segments array is initialized
                if (!docSnap.data().segments || docSnap.data().segments.length === 0) {
                    setFormStructure({ segments: [{ id: generateId('seg'), title: 'Step 1: Default Segment', fields: [] }] });
                }
            } else {
                // If doc doesn't exist, seed a default structure
                setFormStructure({ segments: [{ id: generateId('seg'), title: 'Step 1: Default Segment', fields: [] }] });
            }
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching form structure:", error);
            showStatus("Error loading form structure.", true);
            setIsLoading(false);
        });

        return () => unsub();
    }, [db]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Remove the selected field to ensure no temporary UI state is saved
            setSelectedField(null);
            await setDoc(doc(db, DOC_FORM_STRUCTURE), formStructure);
            showStatus("Form structure saved successfully!", false);
        } catch (error) {
            console.error("Error saving form structure:", error);
            showStatus("Failed to save form structure.", true);
        }
        setIsSaving(false);
    };

    const updateFormStructure = (newSegments) => {
        setFormStructure({ ...formStructure, segments: newSegments });
    };

    // --- Segment Management ---
    const addSegment = () => {
        const newSegments = [...formStructure.segments, { id: generateId('seg'), title: `New Step ${formStructure.segments.length + 1}`, fields: [] }];
        updateFormStructure(newSegments);
        setCurrentSegmentIndex(newSegments.length - 1);
    };

    const deleteSegment = (index) => {
        if (formStructure.segments.length <= 1) {
            showStatus("Cannot delete the last segment.", true);
            return;
        }
        const newSegments = formStructure.segments.filter((_, i) => i !== index);
        updateFormStructure(newSegments);
        setCurrentSegmentIndex(Math.min(index, newSegments.length - 1));
    };

    const renameSegment = (index, newTitle) => {
        const newSegments = formStructure.segments.map((seg, i) => i === index ? { ...seg, title: newTitle } : seg);
        updateFormStructure(newSegments);
    };

    // New: Segment Reordering Handler
    const handleSegmentReorder = (fromIndex, toIndex) => {
        const newSegments = [...formStructure.segments];
        const [movedSegment] = newSegments.splice(fromIndex, 1);
        newSegments.splice(toIndex, 0, movedSegment);
        updateFormStructure(newSegments);
        setCurrentSegmentIndex(newSegments.findIndex(s => s.id === movedSegment.id));
    };

    // --- Field Management ---
    const addField = (type) => {
        const currentSegment = formStructure.segments[currentSegmentIndex];
        const fieldConfig = FieldTypeMap[type];
        const newField = {
            id: generateId('field'),
            type: type,
            label: fieldConfig.name,
            required: false,
            placeholder: `Enter ${fieldConfig.name.toLowerCase()}...`,
            options: Array.isArray(fieldConfig.defaultOptions) ? fieldConfig.defaultOptions : undefined,
            ...fieldConfig.defaultOptions,
        };

        const newSegments = formStructure.segments.map((seg, i) => {
            if (i === currentSegmentIndex) {
                return { ...seg, fields: [...seg.fields, newField] };
            }
            return seg;
        });

        updateFormStructure(newSegments);
        setSelectedField(newField); // Immediately open inspector for new field
    };

    const updateField = (updatedField) => {
        const newSegments = formStructure.segments.map((seg, i) => {
            if (i === currentSegmentIndex) {
                return {
                    ...seg,
                    fields: seg.fields.map(f => f.id === updatedField.id ? updatedField : f)
                };
            }
            return seg;
        });
        updateFormStructure(newSegments);
        setSelectedField(updatedField);
    };

    const deleteField = (fieldId) => {
        const newSegments = formStructure.segments.map((seg, i) => {
            if (i === currentSegmentIndex) {
                return {
                    ...seg,
                    fields: seg.fields.filter(f => f.id !== fieldId)
                };
            }
            return seg;
        });
        updateFormStructure(newSegments);
        setSelectedField(null);
    };

    const handleFieldReorder = (fromIndex, toIndex) => {
        const currentSegment = formStructure.segments[currentSegmentIndex];
        const newFields = [...currentSegment.fields];
        const [movedField] = newFields.splice(fromIndex, 1);
        newFields.splice(toIndex, 0, movedField);

        const newSegments = formStructure.segments.map((seg, i) => {
            if (i === currentSegmentIndex) {
                return { ...seg, fields: newFields };
            }
            return seg;
        });
        updateFormStructure(newSegments);
    };

    const currentSegment = formStructure.segments[currentSegmentIndex];

    if (isLoading) return <LoadingScreen />;

    return (
        <div className="min-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800 flex items-center"><FileText className="w-7 h-7 mr-2 text-indigo-600" /> Form Builder</h1>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center px-6 py-3 bg-emerald-500 text-white rounded-full shadow-lg hover:bg-emerald-600 transition duration-300 disabled:bg-gray-400"
                >
                    {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Save Form Structure
                </button>
            </div>

            {statusMessage && (
                <div className={`mb-4 p-3 rounded-lg font-medium ${statusMessage.isError ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {statusMessage.message}
                </div>
            )}

            {/* Segment Tabs (Reordering Enabled) */}
            <Card className="mb-6 p-4">
                <div className="flex flex-wrap items-center gap-3">
                    {formStructure.segments.map((segment, index) => (
                        <div key={segment.id} className="relative group"
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData('text/plain', index)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                                handleSegmentReorder(fromIndex, index);
                            }}
                        >
                            <button
                                onClick={() => setCurrentSegmentIndex(index)}
                                className={`px-4 py-2 rounded-xl text-sm font-medium transition duration-200 shadow-md ${index === currentSegmentIndex ? 'bg-indigo-600 text-white ring-2 ring-indigo-300' : 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-50'} flex items-center cursor-move`}
                            >
                                <ListOrdered className="w-4 h-4 mr-1" />
                                {segment.title}
                            </button>
                            <button
                                onClick={() => deleteSegment(index)}
                                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition"
                                title="Delete Segment"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                    <button onClick={addSegment} className="flex items-center px-4 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition duration-200 border border-emerald-300">
                        <Plus className="w-4 h-4 mr-1" /> Add Segment
                    </button>
                </div>
            </Card>

            {/* Segment Renaming Input (Moved out of inspector for easier access) */}
            {currentSegment && (
                <Card className="mb-6 p-4 border-l-4 border-indigo-500">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Current Segment Title (Editable)</label>
                    <input
                        type="text"
                        className="w-full p-2 border rounded-lg text-lg font-semibold"
                        value={currentSegment.title}
                        onChange={(e) => renameSegment(currentSegmentIndex, e.target.value)}
                    />
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
                {/* Field Library */}
                <Card title="Field Library" className="lg:col-span-1 h-fit sticky top-24 bg-gray-100 p-4">
                    <p className="text-sm text-gray-600 mb-3">Click to add a new field to the current step.</p>
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                        {Object.entries(FieldTypeMap).map(([type, config]) => (
                            <button
                                key={type}
                                onClick={() => addField(type)}
                                className="w-full flex items-center p-2 bg-white rounded-lg border border-gray-200 text-gray-700 hover:bg-indigo-50 transition duration-150 shadow-sm"
                            >
                                <config.icon className="w-4 h-4 mr-2 text-indigo-500" />
                                <span className="text-sm">{config.name}</span>
                            </button>
                        ))}
                    </div>
                </Card>

                {/* Form Canvas */}
                <Card title={`Fields for: ${currentSegment?.title || 'Loading...'}`} className="lg:col-span-2 min-h-[400px] border-t-4 border-indigo-600">
                    <p className="text-sm text-gray-500 mb-4">Drag and drop fields to reorder them in this step.</p>
                    {currentSegment?.fields.length === 0 ? (
                        <div className="text-center py-10 text-gray-500 border-dashed border-2 border-gray-300 rounded-xl">
                            No fields in this segment. Add a field from the library.
                        </div>
                    ) : (
                        currentSegment.fields.map((field, index) => (
                            <div
                                key={field.id}
                                className={`p-4 mb-3 border rounded-xl transition duration-200 hover:shadow-lg cursor-pointer ${field.id === selectedField?.id ? 'border-indigo-600 ring-2 ring-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                                onClick={() => setSelectedField(field)}
                                draggable
                                onDragStart={(e) => e.dataTransfer.setData('text/plain', index)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                                    handleFieldReorder(fromIndex, index);
                                }}
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center">
                                        {React.createElement(FieldTypeMap[field.type]?.icon || Info, { className: 'w-5 h-5 mr-3 text-emerald-600' })}
                                        <span className="font-semibold text-gray-800">{field.label}</span>
                                        {field.required && <span className="ml-2 text-red-500 text-sm">(Required)</span>}
                                    </div>
                                    <div className="flex space-x-2">
                                        <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedField(field); }} className="p-1 text-indigo-600 hover:bg-indigo-100 rounded-full transition"><Edit className="w-4 h-4" /></button>
                                        <button type="button" onClick={(e) => { e.stopPropagation(); deleteField(field.id); }} className="p-1 text-red-600 hover:bg-red-100 rounded-full transition"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500 mt-1 ml-8">{FieldTypeMap[field.type]?.name} | ID: {field.id}</p>
                            </div>
                        ))
                    )}
                </Card>

                {/* Field Inspector */}
                <Card title="Field Inspector" className="lg:col-span-1 h-fit sticky top-24 bg-indigo-50 p-4">
                    {!selectedField ? (
                        <p className="text-gray-600">Select a field on the canvas to edit its properties.</p>
                    ) : (
                        <FieldInspector field={selectedField} updateField={updateField} deleteField={deleteField} renameSegment={renameSegment} currentSegmentIndex={currentSegmentIndex} />
                    )}
                </Card>
            </div>
        </div>
    );
};

const FieldInspector = ({ field, updateField, deleteField, renameSegment, currentSegmentIndex }) => {
    const FieldConfig = FieldTypeMap[field.type];

    const handlePropChange = (key, value) => {
        const updated = { ...field, [key]: value };
        // Special case: When required is toggled, clear placeholder if empty
        if (key === 'required' && !value && !updated.placeholder) {
             updated.placeholder = `Enter ${FieldConfig.name.toLowerCase()}...`;
        }
        updateField(updated);
    };

    const handleOptionChange = (index, value) => {
        const newOptions = [...field.options];
        newOptions[index] = value;
        updateField({ ...field, options: newOptions });
    };

    const addOption = () => {
        updateField({ ...field, options: [...(field.options || []), `New Option ${field.options?.length + 1 || 1}`] });
    };

    const removeOption = (index) => {
        updateField({ ...field, options: field.options.filter((_, i) => i !== index) });
    };

    const renderOptions = () => {
        if (!field.options) return null;

        return (
            <div className="space-y-3">
                <h4 className="font-semibold text-gray-800">Options</h4>
                {field.options.map((option, index) => (
                    <div key={index} className="flex items-center space-x-2">
                        <input
                            type="text"
                            className="flex-1 p-2 border rounded-lg text-sm"
                            value={option}
                            onChange={(e) => handleOptionChange(index, e.target.value)}
                        />
                        <button onClick={() => removeOption(index)} className="text-red-500 hover:text-red-700 p-1 rounded-full bg-white transition">
                            <Minus className="w-4 h-4" />
                        </button>
                    </div>
                ))}
                <button type="button" onClick={addOption} className="w-full p-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition text-sm">
                    <Plus className="w-4 h-4 inline mr-1" /> Add Option
                </button>
            </div>
        );
    };

    const renderScaleConfig = () => {
        if (field.type !== 'LinearScale' && field.type !== 'Slider' && field.type !== 'StarRating' && field.type !== 'HeartRating') return null;

        return (
            <div className="space-y-3">
                <h4 className="font-semibold text-gray-800">Scale Configuration</h4>
                <div className="flex space-x-4">
                    <label className="block text-sm font-medium text-gray-700">Min Value</label>
                    <input type="number" className="w-1/3 p-2 border rounded-lg text-sm" value={field.min || 0} onChange={(e) => handlePropChange('min', Number(e.target.value))} />
                    <label className="block text-sm font-medium text-gray-700">Max Value</label>
                    <input type="number" className="w-1/3 p-2 border rounded-lg text-sm" value={field.max || 0} onChange={(e) => handlePropChange('max', Number(e.target.value))} />
                </div>
                {(field.type === 'LinearScale' || field.type === 'Slider') && (
                    <div className="flex space-x-4">
                        <label className="block text-sm font-medium text-gray-700">Step Size</label>
                        <input type="number" className="w-1/3 p-2 border rounded-lg text-sm" value={field.step || 1} onChange={(e) => handlePropChange('step', Number(e.target.value))} />
                    </div>
                )}
            </div>
        );
    };

    const renderMediaConfig = () => {
        if (field.type === 'ImageDisplay') return (
            <div className="space-y-3">
                <h4 className="font-semibold text-gray-800">Image URL</h4>
                <input type="url" className="w-full p-2 border rounded-lg text-sm" value={field.imageUrl || ''} onChange={(e) => handlePropChange('imageUrl', e.target.value)} />
            </div>
        );
        if (field.type === 'VideoDisplay') return (
            <div className="space-y-3">
                <h4 className="font-semibold text-gray-800">Video Embed URL</h4>
                <input type="url" className="w-full p-2 border rounded-lg text-sm" value={field.url || ''} onChange={(e) => handlePropChange('url', e.target.value)} />
            </div>
        );
        if (field.type === 'Instructions') return (
            <div className="space-y-3">
                <h4 className="font-semibold text-gray-800">Rich Text Content (HTML)</h4>
                <textarea rows="6" className="w-full p-2 border rounded-lg text-sm font-mono" value={field.content || ''} onChange={(e) => handlePropChange('content', e.target.value)} />
            </div>
        );
        if (field.type === 'ImageQuestion') return (
            <div className="space-y-3">
                <h4 className="font-semibold text-gray-800">Image Question Configuration</h4>
                <label className="block text-sm font-medium text-gray-700">Image URL</label>
                <input type="url" className="w-full p-2 border rounded-lg text-sm" value={field.imageUrl || ''} onChange={(e) => handlePropChange('imageUrl', e.target.value)} />
                <label className="flex items-center text-sm font-medium text-gray-700 mt-2">
                    <input
                        type="checkbox"
                        checked={field.optionalLongText || false}
                        onChange={(e) => handlePropChange('optionalLongText', e.target.checked)}
                        className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 mr-2"
                    />
                    Include Optional Long Text Area
                </label>
                {renderOptions()}
            </div>
        );
        return null;
    };

    return (
        <div className="space-y-4">
            <h3 className="text-xl font-bold text-indigo-700 border-b pb-2 mb-4">{FieldConfig.name}</h3>

            {/* Note: Segment editing is now handled outside the Field Inspector for UX consistency */}
            {/* Field Inspector only handles Field-specific properties */}

            <div className="space-y-3">
                <h4 className="font-semibold text-gray-800">Core Field Settings</h4>
                <label className="block text-sm font-medium text-gray-700">Field Label</label>
                <input type="text" className="w-full p-2 border rounded-lg text-sm" value={field.label || ''} onChange={(e) => handlePropChange('label', e.target.value)} />

                {FieldConfig.defaultOptions === null && FieldConfig.name !== 'Signature' && FieldConfig.name !== 'File Upload' && (
                    <>
                        <label className="block text-sm font-medium text-gray-700">Placeholder</label>
                        <input type="text" className="w-full p-2 border rounded-lg text-sm" value={field.placeholder || ''} onChange={(e) => handlePropChange('placeholder', e.target.value)} />
                    </>
                )}

                <label className="flex items-center text-sm font-medium text-gray-700 mt-2">
                    <input
                        type="checkbox"
                        checked={field.required || false}
                        onChange={(e) => handlePropChange('required', e.target.checked)}
                        className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 mr-2"
                    />
                    Required Field
                </label>
            </div>

            {/* Field Type Specific Settings */}
            {(FieldConfig.defaultOptions && Array.isArray(FieldConfig.defaultOptions)) && renderOptions()}
            {renderScaleConfig()}
            {renderMediaConfig()}

            <div className="pt-4 border-t mt-4 flex justify-end">
                <button onClick={() => deleteField(field.id)} className="flex items-center text-red-600 hover:text-red-800 transition">
                    <Trash2 className="w-4 h-4 mr-1" /> Delete Field
                </button>
            </div>
        </div>
    );
};

// --- 6.2.3 Invite Code Manager ---

const CodeManager = () => {
    const { db } = React.useContext(AppContext);
    const [codes, setCodes] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [statusMessage, setStatusMessage] = useState(null);

    // Generation State
    const [numToGenerate, setNumToGenerate] = useState(1);
    const [prefix, setPrefix] = useState('IUEC-');
    const [randomLength, setRandomLength] = useState(6);
    const [isGenerating, setIsGenerating] = useState(false);

    const showStatus = (message, isError = false) => {
        setStatusMessage({ message, isError });
        setTimeout(() => setStatusMessage(null), 3000);
    };

    useEffect(() => {
        if (!db) return;

        const q = query(collection(db, COL_INVITE_CODES));
        const unsub = onSnapshot(q, (snapshot) => {
            const codeList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate().toLocaleString() || 'N/A'
            }));
            setCodes(codeList);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching invite codes:", error);
            showStatus("Error loading invite codes.", true);
            setIsLoading(false);
        });

        return () => unsub();
    }, [db]);

    const generateRandomString = (length) => {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    };

    const handleGenerate = async () => {
        if (!db || isGenerating) return;

        setIsGenerating(true);
        const generatedCodes = [];
        try {
            for (let i = 0; i < numToGenerate; i++) {
                const codeString = (prefix.toUpperCase() + generateRandomString(randomLength)).replace(/[^A-Z0-9-]/g, '');
                generatedCodes.push({
                    code: codeString,
                    used: false,
                    createdAt: new Date(),
                    usedBySubmissionId: null,
                });
            }

            // Using transaction for atomic batch write as recommended
            await runTransaction(db, async (transaction) => {
                generatedCodes.forEach(codeData => {
                    const newDocRef = doc(collection(db, COL_INVITE_CODES));
                    transaction.set(newDocRef, codeData);
                });
            });

            showStatus(`${numToGenerate} code(s) generated successfully!`);
        } catch (error) {
            console.error("Error generating codes:", error);
            showStatus("Failed to generate codes: " + error.message, true);
        }
        setIsGenerating(false);
    };

    const handleDelete = async (id) => {
        if (!db) return;
        try {
            await deleteDoc(doc(db, COL_INVITE_CODES, id));
            showStatus("Code deleted successfully!");
        } catch (error) {
            console.error("Error deleting code:", error);
            showStatus("Failed to delete code.", true);
        }
    };

    const handleToggleUsed = async (id, currentUsed) => {
        if (!db) return;
        try {
            await updateDoc(doc(db, COL_INVITE_CODES, id), {
                used: !currentUsed,
                usedBySubmissionId: !currentUsed ? 'MANUALLY_RESET' : null,
            });
            showStatus(`Code status toggled to ${!currentUsed ? 'USED' : 'UNUSED'}!`);
        } catch (error) {
            console.error("Error toggling code status:", error);
            showStatus("Failed to toggle code status.", true);
        }
    };

    const handleCopy = (code) => {
        navigator.clipboard.writeText(code).then(() => {
            showStatus("Code copied to clipboard!");
        }).catch(err => {
            console.error("Failed to copy text:", err);
            showStatus("Failed to copy code.", true);
        });
    };

    const handleExport = () => {
        const dataToExport = codes.map(code => ({
            Code: code.code,
            Status: code.used ? 'USED' : 'UNUSED',
            'Created At': code.createdAt,
            'Used By Submission ID': code.usedBySubmissionId || 'N/A',
        }));
        exportData(dataToExport, 'csv', 'iuec_invite_codes');
    };

    if (isLoading) return <LoadingScreen />;

    return (
        <>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800 flex items-center"><Key className="w-7 h-7 mr-2 text-indigo-600" /> Invite Code Manager</h1>
                <IconButton onClick={handleExport} Icon={Upload} className="bg-indigo-600 hover:bg-indigo-700">Export CSV</IconButton>
            </div>

            {statusMessage && (
                <div className={`mb-4 p-3 rounded-lg font-medium ${statusMessage.isError ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {statusMessage.message}
                </div>
            )}

            {/* Code Generation Panel */}
            <Card title="Generate New Codes" className="mb-8 border-t-4 border-emerald-500">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Prefix/Slug</label>
                        <input type="text" className="w-full p-2 border rounded-lg" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="IUEC-" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Random Length (1-10)</label>
                        <input type="number" className="w-full p-2 border rounded-lg" min="1" max="10" value={randomLength} onChange={(e) => setRandomLength(Math.min(10, Math.max(1, Number(e.target.value))))} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Quantity</label>
                        <input type="number" className="w-full p-2 border rounded-lg" min="1" max="100" value={numToGenerate} onChange={(e) => setNumToGenerate(Math.min(100, Math.max(1, Number(e.target.value))))} />
                    </div>
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="flex items-center justify-center h-full px-6 py-3 bg-indigo-600 text-white rounded-lg shadow-md hover:bg-indigo-700 transition disabled:bg-gray-400"
                    >
                        {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5 mr-2" />}
                        Generate Codes
                    </button>
                </div>
            </Card>

            {/* Code List */}
            <Card title={`All Invite Codes (${codes.length})`}>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Used By Submission ID</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {codes.map(code => (
                                <tr key={code.id} className="hover:bg-indigo-50 transition duration-150">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-indigo-700">{code.code}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-3 inline-flex text-xs leading-5 font-semibold rounded-full ${code.used ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                            {code.used ? 'USED' : 'UNUSED'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{code.createdAt}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 truncate max-w-xs">{code.usedBySubmissionId || 'N/A'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                        <button onClick={() => handleCopy(code.code)} className="text-indigo-600 hover:text-indigo-900 transition" title="Copy"><ClipboardList className="w-4 h-4 inline" /></button>
                                        <button onClick={() => handleToggleUsed(code.id, code.used)} className={`${code.used ? 'text-emerald-600 hover:text-emerald-900' : 'text-red-600 hover:text-red-900'} transition`} title={code.used ? 'Mark UNUSED' : 'Mark USED'}>
                                            {code.used ? <CheckCircle className="w-4 h-4 inline" /> : <X className="w-4 h-4 inline" />}
                                        </button>
                                        <button onClick={() => handleDelete(code.id)} className="text-red-600 hover:text-red-900 transition" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {codes.length === 0 && <p className="text-center py-6 text-gray-500">No invite codes have been generated yet.</p>}
            </Card>
        </>
    );
};

// --- 6.2.4 Submissions Manager ---

const SubmissionDetailModal = ({ isOpen, onClose, submission, formStructure }) => {
    if (!submission || !formStructure) return null;

    const allFields = formStructure.segments.flatMap(s => s.fields);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Submission Details" size="xl">
            <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 border-b pb-4">
                    <p><strong>Submission ID:</strong> <span className="font-mono text-sm">{submission.id}</span></p>
                    <p><strong>Submission Date:</strong> {new Date(submission.submissionDate.seconds * 1000).toLocaleString()}</p>
                    <p><strong>Name:</strong> {submission.name}</p>
                    <p><strong>Email:</strong> {submission.email}</p>
                    <p><strong>Invite Code ID:</strong> <span className="font-mono text-sm">{submission.inviteCode}</span></p>
                </div>

                {formStructure.segments.map(segment => (
                    <div key={segment.id}>
                        <h3 className="text-xl font-bold text-indigo-600 mb-4">{segment.title}</h3>
                        <div className="space-y-4 p-4 border rounded-lg bg-gray-50">
                            {segment.fields.map(field => {
                                const answer = submission.answers[field.id];
                                let displayValue;

                                if (answer === undefined || answer === null || answer === '') {
                                    displayValue = <span className="text-gray-400 italic">No Answer</span>;
                                } else if (field.type === 'ImageQuestion') {
                                    const selection = Array.isArray(answer.selection) ? answer.selection.join(' | ') : 'N/A';
                                    const explanation = answer.explanation || 'N/A';
                                    displayValue = (
                                        <div className="space-y-1">
                                            <p><span className="font-medium">Selection:</span> {selection}</p>
                                            <p><span className="font-medium">Explanation:</span> {explanation}</p>
                                        </div>
                                    );
                                } else if (Array.isArray(answer)) {
                                    displayValue = answer.join(' | ');
                                } else if (field.type === 'Instructions' || field.type === 'ImageDisplay' || field.type === 'VideoDisplay') {
                                    return null; // Don't show these in the answers list
                                } else {
                                    displayValue = answer.toString();
                                }

                                return (
                                    <div key={field.id} className="border-b pb-3">
                                        <p className="font-semibold text-gray-700">{field.label}</p>
                                        <div className="pl-4 pt-1 text-gray-800 bg-white p-2 rounded-md shadow-inner">{displayValue}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </Modal>
    );
};

const SubmissionsManager = () => {
    const { db } = React.useContext(AppContext);
    const [submissions, setSubmissions] = useState([]);
    const [formStructure, setFormStructure] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedSubmission, setSelectedSubmission] = useState(null);
    const [statusMessage, setStatusMessage] = useState(null);

    const showStatus = (message, isError = false) => {
        setStatusMessage({ message, isError });
        setTimeout(() => setStatusMessage(null), 3000);
    };

    useEffect(() => {
        if (!db) return;

        // Fetch Form Structure (needed for display and export)
        const unsubForm = onSnapshot(doc(db, DOC_FORM_STRUCTURE), (docSnap) => {
            if (docSnap.exists()) {
                setFormStructure(docSnap.data());
            }
        }, (error) => console.error("Error fetching form structure for submissions:", error));

        // Fetch Submissions
        const qSubmissions = query(collection(db, COL_SUBMISSIONS));
        const unsubSubmissions = onSnapshot(qSubmissions, (snapshot) => {
            const submissionList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            }));
            setSubmissions(submissionList);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching submissions:", error);
            showStatus("Error loading submissions.", true);
            setIsLoading(false);
        });

        return () => { unsubForm(); unsubSubmissions(); };
    }, [db]);

    const handleExport = (format) => {
        if (submissions.length === 0) {
            showStatus("No data to export.", true);
            return;
        }
        // Export submissions, flattening the 'answers' object for CSV
        exportData(submissions, format, 'iuec_submissions');
        showStatus(`Data exported to ${format.toUpperCase()} successfully!`);
    };

    if (isLoading) return <LoadingScreen />;

    return (
        <>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800 flex items-center"><ClipboardList className="w-7 h-7 mr-2 text-indigo-600" /> Submissions Manager</h1>
                <div className="flex space-x-3">
                    <button onClick={() => handleExport('csv')} className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-full shadow-md hover:bg-indigo-700 transition duration-300">
                        <Upload className="w-4 h-4 mr-2" /> Export CSV
                    </button>
                    <button onClick={() => handleExport('json')} className="flex items-center px-4 py-2 bg-emerald-500 text-white rounded-full shadow-md hover:bg-emerald-600 transition duration-300">
                        <Upload className="w-4 h-4 mr-2" /> Export JSON
                    </button>
                </div>
            </div>

            {statusMessage && (
                <div className={`mb-4 p-3 rounded-lg font-medium ${statusMessage.isError ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {statusMessage.message}
                </div>
            )}

            <Card title={`All Membership Submissions (${submissions.length})`}>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submission Date</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invite Code ID</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {submissions.map(sub => (
                                <tr key={sub.id} className="hover:bg-indigo-50 transition duration-150">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{sub.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sub.email}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(sub.submissionDate.seconds * 1000).toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">{sub.inviteCode}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button onClick={(e) => { e.stopPropagation(); setSelectedSubmission(sub); }} className="text-indigo-600 hover:text-indigo-900 transition font-semibold">View Details</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {submissions.length === 0 && <p className="text-center py-6 text-gray-500">No submissions received yet.</p>}
            </Card>

            <SubmissionDetailModal
                isOpen={!!selectedSubmission}
                onClose={() => setSelectedSubmission(null)}
                submission={selectedSubmission}
                formStructure={formStructure}
            />
        </>
    );
};

// --- 7. MAIN APPLICATION COMPONENT ---

const App = () => {
    const { path, navigate } = useRoute();
    const { isAdmin, isLoading, login, logout } = React.useContext(AppContext);
    const [loginError, setLoginError] = useState(null);

    // Dynamic Route Management
    let content;
    const isDashboardRoute = path.startsWith('/dashboard');

    if (isLoading) {
        content = <LoadingScreen />;
    } else if (path === '/dashboard/login') {
        content = isAdmin
            ? <div className="p-10 text-center"><p className="text-xl">Already logged in. Redirecting to dashboard...</p></div>
            : <AdminLogin navigate={navigate} login={login} error={loginError} setError={setLoginError} isLoading={isLoading} />;
    } else if (isDashboardRoute) {
        content = (
            <AdminLayout navigate={navigate} path={path}>
                {path === '/dashboard/content' && <ContentBuilder />}
                {path === '/dashboard/forms' && <FormBuilder />}
                {path === '/dashboard/codes' && <CodeManager />}
                {path === '/dashboard/submissions' && <SubmissionsManager />}
                {/* Default to Content Builder if path is just /dashboard */}
                {path.split('/').length <= 2 && path.includes('dashboard') && <DashboardHome />} 
                {/* Fallback to Dashboard Home for root dashboard or unrecognized sub-paths */}
            </AdminLayout>
        );
    } else {
        // Public routes
        content = (
            <>
                <Header navigate={navigate} isAdmin={isAdmin} logout={logout} path={path} />
                <div className="font-sans min-h-screen bg-gray-50/50">
                    {path === '/home' && <HomePage navigate={navigate} />}
                    {path === '/register' && <RegisterPage navigate={navigate} />}
                    {path === '/thank-you' && <ThankYouPage />}
                    {/* Fallback to home */}
                    {!(path === '/home' || path === '/register' || path === '/thank-you') && <HomePage navigate={navigate} />}
                </div>
            </>
        );
    }

    return (
        <div className="min-h-screen font-sans bg-gray-50 antialiased">
            {/* Tailwind CSS Setup - Only load Inter font if needed (already in environment) */}
            <style>
                {`
                /* Simple CSS for fadeIn/Up animation */
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translate3d(0, 20px, 0); }
                    to { opacity: 1; transform: translate3d(0, 0, 0); }
                }
                .animate-fadeInUp {
                    animation: fadeInUp 0.5s ease-out forwards;
                    opacity: 0;
                }
                .delay-100 { animation-delay: 0.1s; }
                .delay-200 { animation-delay: 0.2s; }
                .delay-300 { animation-delay: 0.3s; }
                `}
            </style>
            {content}
        </div>
    );
};

// Export the main component wrapped in the provider
export default () => (
    <FirebaseProvider>
        <App />
    </FirebaseProvider>
);
