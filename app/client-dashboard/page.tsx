"use client"

import { useState, useEffect } from "react"
import { Navbar } from "../components/Navbar"
import { Footer } from "../components/Footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Bell, Upload, FileText, IndianRupee, MessageSquare, RefreshCw, Plus, Send } from "lucide-react"
import { PaymentDialog } from "../components/PaymentDialog"
import { JobRequestDialog, JobRequest } from "../components/JobRequestDialog"
import { generateInvoicePDF } from "../components/Invoice"
import { InvoicePreviewDialog } from "../components/InvoicePreviewDialog"
import { useAuth } from "@/contexts/AuthContext"
import { jobsApi, paymentsApi, documentsApi, jobRequestsApi } from "@/lib/api"
import { storageApi } from "@/lib/api"
import { supabase } from "@/lib/supabase"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

type JobMessage = {
  id: number
  content: string
  from_admin: boolean
  created_at: string
}

type Job = {
  id: number
  name: string
  status: string
  deadline: string
  progress: number
  latestUpdate?: string
  latest_update?: string
  amount: number
  created_at: string
  client?: {
    full_name: string
    email: string
  }
  messages?: JobMessage[]
}

type Payment = {
  id: number
  date: string
  amount: number
  description: string
  status: 'Paid' | 'Pending'
  paymentMethod?: string
  paidAt?: string
  payment_method?: string
  paid_at?: string
  created_at?: string
}

type Notification = {
  id: string | number  // Allow both string and number IDs
  message: string
  timestamp: string
  read: boolean
  type: 'message' | 'payment' | 'document' | 'job'
  data?: {
    amount?: number
    documentName?: string
    status?: string
    from?: string
    jobTitle?: string
    progress?: number
    previousProgress?: number
    content?: string
  }
}

type RequiredDocument = {
  id: number
  name: string
  description: string
  deadline: string
  status: 'Pending' | 'Uploaded' | 'Verified' | 'Rejected'
  uploadedAt?: string
  feedback?: string
}

type Invoice = {
  id: number
  invoiceNumber: string
  paymentId: number
  generatedAt: string
}

type InvoiceData = {
  invoiceNumber: string
  paymentDate: string
  amount: number
  description: string
  paymentMethod: string
  clientName: string
  clientEmail: string
}

type JobRequestFormData = {
  title: string
  type: string
  description: string
  deadline: string
  budget: string
}

// Add new types to distinguish between system and database notifications
type SystemNotification = {
  id: string // Using string for system notifications
  type: 'payment' | 'document'
  message: string
  timestamp: string
  read: boolean
  data?: any
}

type DatabaseNotification = {
  id: number // Using number for database notifications
  type: 'message' | 'job'
  message: string
  timestamp: string
  read: boolean
  data?: any
}

// Add this type
declare global {
  interface Window {
    Razorpay: any;
  }
}

// Add type definition
type PaymentMethod = 'card' | 'upi' | 'netbanking';

export default function ClientDashboard() {
  const { user } = useAuth()
  const [accountStatus, setAccountStatus] = useState("Active")
  const [uploadProgress, setUploadProgress] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [requiredDocuments, setRequiredDocuments] = useState<RequiredDocument[]>([])
  const [jobRequests, setJobRequests] = useState<JobRequest[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null)

  const [jobRequestDialogOpen, setJobRequestDialogOpen] = useState(false)

  const [previewInvoice, setPreviewInvoice] = useState<InvoiceData | null>(null)
  const [invoicePreviewOpen, setInvoicePreviewOpen] = useState(false)

  const [isLoading, setIsLoading] = useState(true)

  const [showNotifications, setShowNotifications] = useState(false)

  // Add state to control seen notifications visibility
  const [showSeenUpdates, setShowSeenUpdates] = useState(false)

  // Update state to track both types separately
  const [systemNotifications, setSystemNotifications] = useState<SystemNotification[]>([])
  const [dbNotifications, setDbNotifications] = useState<DatabaseNotification[]>([])

  // Add this state at the top with other states
  const [buttonStates, setButtonStates] = useState<{[key: string]: boolean}>({});

  useEffect(() => {
    if (user?.id) {
      loadClientData()
      setupRealtimeSubscriptions()
      fetchPayments()
    }
  }, [user?.id])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const notificationButton = document.getElementById('notification-button')
      const notificationDropdown = document.getElementById('notification-dropdown')
      
      if (
        notificationButton && 
        notificationDropdown && 
        !notificationButton.contains(event.target as Node) && 
        !notificationDropdown.contains(event.target as Node)
      ) {
        setShowNotifications(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const setupRealtimeSubscriptions = () => {
    // Subscribe to payments updates
    const paymentsSubscription = supabase
      .channel('payments')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payments',
          filter: `client_id=eq.${user!.id}`
        },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            // Add notification for new payment request
            addNotification({
              type: 'payment',
              message: `New payment request of ₹${payload.new.amount.toLocaleString()} for ${payload.new.description}`,
              data: {
                amount: payload.new.amount,
                status: 'Pending'
              }
            })
          } else if (payload.eventType === 'UPDATE') {
            if (payload.new.status === 'Paid') {
              addNotification({
                type: 'payment',
                message: `Payment of ₹${payload.new.amount.toLocaleString()} has been confirmed`,
                data: {
                  amount: payload.new.amount,
                  status: 'Paid'
                }
              })
            }
          }
          await loadClientData()
        }
      )
      .subscribe()

    // Subscribe to documents updates
    const documentsSubscription = supabase
      .channel('documents')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'documents',
          filter: `client_id=eq.${user!.id}`
        },
        async (payload) => {
          try {
            if (payload.eventType === 'INSERT') {
              // Create notification for new document request
              const { error: notifError } = await supabase
                .from('notifications')
                .insert([
                  {
                    client_id: user!.id,
                    type: 'document',
                    message: `New document requested: ${payload.new.name}. Due by ${formatSimpleDate(payload.new.deadline)}`,
                    data: {
                      documentName: payload.new.name,
                      status: 'Pending',
                      deadline: payload.new.deadline
                    },
                    read: false,
                    created_at: new Date().toISOString()
                  }
                ])

              if (notifError) throw notifError

              // Show toast
              toast.info(`Document Request: ${payload.new.name}`, { icon: '📄' })
            } else if (payload.eventType === 'UPDATE') {
              let message = ''
              let status = payload.new.status

              if (status === 'Verified') {
                message = `Document "${payload.new.name}" has been verified`
              } else if (status === 'Rejected') {
                message = `Document "${payload.new.name}" was rejected. Reason: ${payload.new.feedback}`
              }

              if (message) {
                // Create notification for status update
                const { error: notifError } = await supabase
                  .from('notifications')
                  .insert([
                    {
                      client_id: user!.id,
                      type: 'document',
                      message,
                      data: {
                        documentName: payload.new.name,
                        status,
                        feedback: payload.new.feedback
                      },
                      read: false,
                      created_at: new Date().toISOString()
                    }
                  ])

                if (notifError) throw notifError

                // Show toast
                toast.info(`Document Update: ${payload.new.name}`, { icon: '📄' })
              }
            }

            // Refresh data
            await loadClientData()
          } catch (error) {
            console.error('Error handling document update:', error)
            toast.error('Failed to process document update')
          }
        }
      )
      .subscribe()

    // Update jobs subscription to handle admin updates
    const jobsSubscription = supabase
      .channel('client-jobs')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `client_id=eq.${user!.id}`
        },
        async (payload) => {
          const oldProgress = payload.old.progress
          const newProgress = payload.new.progress
          const oldStatus = payload.old.status
          const newStatus = payload.new.status
          const newUpdate = payload.new.latest_update

          // Handle progress updates
          if (oldProgress !== newProgress) {
            addNotification({
              type: 'job',
              message: `Job "${payload.new.title}" progress updated to ${newProgress}%`,
              data: {
                jobTitle: payload.new.title,
                progress: newProgress,
                previousProgress: oldProgress,
                status: newStatus
              }
            })
          }

          // Handle status changes
          if (oldStatus !== newStatus) {
            addNotification({
              type: 'job',
              message: `Job "${payload.new.title}" status changed to ${newStatus}`,
              data: {
                jobTitle: payload.new.title,
                status: newStatus,
                progress: newProgress
              }
            })
          }

          // Handle latest update changes
          if (payload.old.latest_update !== newUpdate && newUpdate) {
            addNotification({
              type: 'job',
              message: `New update for "${payload.new.title}": ${newUpdate}`,
              data: {
                jobTitle: payload.new.title,
                status: newStatus,
                progress: newProgress
              }
            })
          }

          await loadClientData()
        }
      )
      .subscribe()

    // Update messages subscription to handle admin messages
    const messagesSubscription = supabase
      .channel('messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `client_id=eq.${user!.id} AND from_admin=true`
        },
        async (payload) => {
          addNotification({
            type: 'message',
            message: payload.new.content,
            data: {
              from: 'Admin',
              content: payload.new.content
            }
          })
          await loadClientData()
        }
      )
      .subscribe()

    return () => {
      paymentsSubscription.unsubscribe()
      documentsSubscription.unsubscribe()
      messagesSubscription.unsubscribe()
      jobsSubscription.unsubscribe()
    }
  }

  const addNotification = async (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    try {
      // Create notification in database
      const { data, error } = await supabase
        .from('notifications')
        .insert([
          {
            client_id: user!.id,
            type: notification.type,
            message: notification.message,
            data: notification.data,
            read: false,
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single()

      if (error) throw error

      // Update local state
      setNotifications(prev => [data, ...prev])

      // Show toast
      const toastMessage = `${notification.type.charAt(0).toUpperCase() + notification.type.slice(1)}: ${notification.message}`
      switch (notification.type) {
        case 'payment':
          toast.info(toastMessage, { icon: '💰' })
          break
        case 'document':
          toast.info(toastMessage, { icon: '📄' })
          break
        case 'job':
          toast.info(toastMessage, { icon: '🔄' })
          break
        case 'message':
          toast.info(toastMessage, { icon: '💬' })
          break
      }
    } catch (error) {
      console.error('Error adding notification:', error)
    }
  }

  const loadClientData = async () => {
    try {
      setIsLoading(true)
      const [jobsData, paymentsData, documentsData, requestsData] = await Promise.all([
        supabase
          .from('jobs')
          .select('*')
          .eq('client_id', user!.id)
          .order('created_at', { ascending: false }),
        paymentsApi.getClientPayments(user!.id),
        documentsApi.getClientDocuments(user!.id),
        supabase
          .from('job_requests')
          .select('*')
          .eq('client_id', user!.id)
          .order('created_at', { ascending: false }),
      ])

      // Load jobs with messages
      if (jobsData.data) {
        const jobsWithMessages = await Promise.all(
          jobsData.data.map(async (job) => {
            const messages = await fetchJobMessages(job.id)
            return {
              ...job,
              messages
            }
          })
        )
        setJobs(jobsWithMessages)
      }
      setPayments(paymentsData)
      setRequiredDocuments(documentsData)
      setJobRequests((requestsData?.data || []).map(request => ({
        id: request.id,
        title: request.title,
        type: request.type,
        description: request.description,
        deadline: request.deadline,
        budget: request.budget,
        status: request.status,
        clientName: user?.full_name || '',
        createdAt: request.created_at
      })))

      // Create system notifications
      const newSystemNotifications: SystemNotification[] = []

      // Add payment notifications
      paymentsData.forEach(payment => {
        if (payment.status === 'Pending') {
          newSystemNotifications.push({
            id: `payment-${payment.id}`,
            type: 'payment',
            message: `New payment request of ₹${payment.amount.toLocaleString()} for ${payment.description}`,
            timestamp: payment.created_at || new Date().toISOString(),
            read: false,
            data: { amount: payment.amount, status: 'Pending' }
          })
        }
      })

      // Add document notifications
      documentsData.forEach(doc => {
        if (doc.status === 'Pending' || doc.status === 'Rejected') {
          newSystemNotifications.push({
            id: `doc-${doc.id}`,
            type: 'document',
            message: doc.status === 'Pending'
              ? `Document required: ${doc.name}. Due by ${formatSimpleDate(doc.deadline)}`
              : `Document "${doc.name}" was rejected. Reason: ${doc.feedback}`,
            timestamp: doc.created_at || new Date().toISOString(),
            read: false,
            data: {
              documentName: doc.name,
              status: doc.status,
              deadline: doc.deadline,
              feedback: doc.feedback
            }
          })
        }
      })

      // Load database notifications
      const { data: notificationsData } = await supabase
        .from('notifications')
        .select('*')
        .eq('client_id', user!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      setSystemNotifications(newSystemNotifications)
      setDbNotifications(notificationsData || [])

    } catch (error) {
      console.error('Error loading client data:', error)
      toast.error('Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleJobRequest = async (formData: JobRequestFormData) => {
    try {
      if (!user) return

      const { error } = await supabase
        .from('job_requests')
        .insert([
          {
            client_id: user.id,
            title: formData.title,
            type: formData.type,
            description: formData.description,
            deadline: formData.deadline,
            budget: formData.budget,
            status: 'Pending'
          }
        ])

      if (error) throw error

      toast.success('Job request submitted successfully')
      setJobRequestDialogOpen(false)
      loadClientData() // Refresh the data
    } catch (error) {
      console.error('Error creating job request:', error)
      toast.error('Failed to submit job request')
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, docId: number) => {
    const file = event.target.files?.[0]
    if (!file || !user) return

    try {
      setUploadProgress(0)
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90))
      }, 200)

      // Add timestamp to filename to prevent duplicates
      const timestamp = new Date().getTime()
      const fileName = `${timestamp}-${file.name}`
      const path = `${docId}/${fileName}`
      
      // Upload file with content-type
      const { error: uploadError } = await supabase
        .storage
        .from('documents')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type // Add content type
        })

      if (uploadError) throw uploadError

      // Update document status
      const { error: updateError } = await supabase
        .from('documents')
        .update({
          status: 'Uploaded',
          uploaded_at: new Date().toISOString(),
          file_name: fileName
        })
        .eq('id', docId)
        .eq('client_id', user.id)

      if (updateError) throw updateError

      clearInterval(progressInterval)
      setUploadProgress(100)
      toast.success("Document uploaded successfully")
      
      // Refresh documents list
      loadClientData()
    } catch (error: any) {
      toast.error("Failed to upload document", {
        description: error.message
      })
      console.error('Error uploading file:', error)
    } finally {
          setTimeout(() => setUploadProgress(0), 1000)
        }
  }

  const markAsRead = async (id: string | number) => {
    try {
      if (typeof id === 'string') {
        // Handle system notification
        setSystemNotifications(prev => 
          prev.map(n => n.id === id ? { ...n, read: true } : n)
        )
      } else {
        // Handle database notification
        setDbNotifications(prev => 
          prev.map(n => n.id === id ? { ...n, read: true } : n)
        )

        const { error } = await supabase
          .from('notifications')
          .update({ read: true })
          .eq('id', id)
          .eq('client_id', user!.id)

        if (error) throw error
      }
    } catch (error) {
      console.error('Error marking as read:', error)
      loadClientData()
    }
  }

  // Add this helper function to manage button states
  const handleButtonAction = async (buttonId: string, action: () => Promise<void>) => {
    if (buttonStates[buttonId]) return; // Prevent double clicks
    
    setButtonStates(prev => ({ ...prev, [buttonId]: true }));
    try {
      await action();
    } catch (error) {
      console.error(`Error in ${buttonId}:`, error);
    } finally {
      setButtonStates(prev => ({ ...prev, [buttonId]: false }));
    }
  };

  // Update the handlePayment function
  const handlePayment = async (paymentId: number) => {
    const payment = payments.find(p => p.id === paymentId);
    if (!payment || !user) return;

    try {
      setIsLoading(true);
      
      // Create Razorpay order
      const orderResponse = await fetch('/api/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: payment.amount,
          payment_id: paymentId,
        }),
      });

      if (!orderResponse.ok) throw new Error('Failed to create order');
      const orderData = await orderResponse.json();

      // Initialize Razorpay
      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'Shan & Associates',
        description: payment.description,
        order_id: orderData.orderId,
        prefill: {
          name: user.full_name,
          email: user.email,
        },
        handler: async function (response: any) {
          try {
            // Update payment status
            const { error } = await supabase
              .from('payments')
              .update({
                status: 'Paid',
                payment_method: 'Razorpay',
                paid_at: new Date().toISOString(),
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              })
              .eq('id', paymentId);

            if (error) throw error;

            // Update local state instead of refreshing
            setPayments(prevPayments => 
              prevPayments.map(p => 
                p.id === paymentId 
                  ? { 
                      ...p, 
                      status: 'Paid', 
                      payment_method: 'Razorpay',
                      paid_at: new Date().toISOString() 
                    }
                  : p
              )
            );

            setPaymentDialogOpen(false);
            toast.success('Payment successful!');
          } catch (error) {
            console.error('Error updating payment:', error);
            toast.error('Payment completed but failed to update status');
          } finally {
            setIsLoading(false);
          }
        },
        modal: {
          ondismiss: function() {
            setIsLoading(false);
            toast.error('Payment cancelled');
          },
        },
        theme: {
          color: '#2563eb',
        },
      };

      const razorpay = new window.Razorpay(options);
      razorpay.open();
    } catch (error) {
      console.error('Payment error:', error);
      toast.error('Failed to initialize payment');
      setIsLoading(false);
    }
  };

  // Add this to handle loading state better
  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      if (!user?.id) return;
      
      try {
        setIsLoading(true);
        await Promise.all([
          loadClientData(),
          setupRealtimeSubscriptions(),
          fetchPayments()
        ]);
      } catch (error) {
        console.error('Initialization error:', error);
        toast.error('Failed to load data');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  }

  const formatSimpleDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  const NotificationItem = ({ 
    notification, 
    onRead,
    formatDate 
  }: { 
    notification: Notification
    onRead: (id: string | number) => void 
    formatDate: (date: string) => string
  }) => (
    <div
      className={`p-3 mb-2 rounded-lg ${
        notification.read ? 'bg-gray-50' : 'bg-blue-50'
      }`}
      onClick={() => onRead(notification.id)}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">
          {notification.type === 'payment' && <IndianRupee className="h-5 w-5 text-blue-500" />}
          {notification.type === 'document' && <FileText className="h-5 w-5 text-green-500" />}
          {notification.type === 'message' && <MessageSquare className="h-5 w-5 text-purple-500" />}
          {notification.type === 'job' && <RefreshCw className="h-5 w-5 text-orange-500" />}
        </div>
        <div className="flex-1">
          <div className="flex justify-between items-start">
            <p className="text-sm flex-1">{notification.message}</p>
            <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
              {formatTimeAgo(notification.timestamp)}
            </span>
          </div>
          {notification.type === 'job' && notification.data?.progress && (
            <div className="mt-2">
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-orange-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${notification.data.progress}%` }}
                ></div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Current Progress: {notification.data.progress}%
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  const markAllAsRead = async () => {
    try {
      // Update all notifications in local state
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))

      // Update database notifications
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('client_id', user!.id)
        .eq('read', false)

      if (error) throw error

      setShowNotifications(false)
    } catch (error) {
      console.error('Error marking all as read:', error)
      loadClientData()
    }
  }

  const deleteAllReadNotifications = async () => {
    try {
      // Get the IDs of read notifications to delete
      const readNotifications = notifications.filter(n => n.read)
      const readNotificationIds = readNotifications.map(n => n.id)

      if (readNotificationIds.length === 0) {
        return // No read notifications to delete
      }

      // Soft delete by updating deleted_at timestamp
      const { error } = await supabase
        .from('notifications')
        .update({ 
          deleted_at: new Date().toISOString() 
        })
        .eq('client_id', user!.id)
        .in('id', readNotificationIds)

      if (error) throw error

      // Update local state
      setNotifications(prev => prev.filter(n => !n.read))
      setShowSeenUpdates(false) // Hide the seen updates section
      toast.success('Cleared all read notifications')
    } catch (error) {
      console.error('Error deleting notifications:', error)
      toast.error('Failed to clear notifications')
      // Refresh to ensure sync
      loadClientData()
    }
  }

  // Add this helper function to format time ago
  const formatTimeAgo = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 7) {
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    } else if (days > 0) {
      return `${days}d ago`
    } else if (hours > 0) {
      return `${hours}h ago`
    } else if (minutes > 0) {
      return `${minutes}m ago`
    } else {
      return 'Just now'
    }
  }

  // Update the fetchJobMessages function
  const fetchJobMessages = async (jobId: number) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching messages:', error)
      return []
    }

    return data || []
  }

  // Update the UI to combine both types for display
  const allNotifications = [...systemNotifications, ...dbNotifications]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const unreadNotifications = allNotifications.filter(n => !n.read)
  const readNotifications = allNotifications.filter(n => n.read)

  const fetchPayments = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        // Transform the data to match your Payment type
        const transformedPayments = data.map(payment => ({
          id: payment.id,
          date: payment.created_at,
          amount: payment.amount,
          description: payment.description,
          status: payment.status,
          paymentMethod: payment.payment_method,
          paidAt: payment.paid_at
        }));

        setPayments(transformedPayments);
      }
    } catch (error) {
      console.error('Error fetching payments:', error);
      toast.error('Failed to load payments');
    }
  };

  // Add this function to handle invoice viewing and download
  const handleViewInvoice = async (payment: any) => {
    try {
      const invoiceNumber = `INV-${payment.id}`;
      
      const invoiceData: InvoiceData = {
        invoiceNumber,
        paymentDate: payment.paid_at || payment.paidAt,
        amount: payment.amount,
        description: payment.description,
        paymentMethod: payment.payment_method || payment.paymentMethod,
        clientName: user?.full_name || "Client",
        clientEmail: user?.email || ""
      };

      // Set preview invoice data
      setPreviewInvoice(invoiceData);
      setInvoicePreviewOpen(true);

      // Generate and download PDF
      await generateInvoicePDF(invoiceData);
      
      toast.success('Invoice downloaded successfully');
    } catch (error) {
      console.error('Error handling invoice:', error);
      toast.error('Failed to generate invoice');
    }
  };

  // Add a helper function to format payment date
  const formatPaymentDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '-'
    try {
      const date = new Date(dateString)
      if (isNaN(date.getTime())) return '-' // Check for invalid date
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
    } catch (error) {
      console.error('Date formatting error:', error)
      return '-'
    }
  }

  // Add error boundary to main content
  useEffect(() => {
    const handleError = () => {
      setIsLoading(false)
      toast.error('Something went wrong. Please refresh the page.')
    }

    window.addEventListener('error', handleError)
    return () => window.removeEventListener('error', handleError)
  }, [])

  // Add fallback UI for loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          <p className="mt-2">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar 
        userType="client"
        userName={user?.full_name}
        orgName="Shan & Associates"
      />
      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Client Dashboard</h1>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm">
              <span className="text-gray-500">Welcome,</span>
              <span className="font-semibold">{user?.full_name || 'Guest'}</span>
            </div>
            <div className="relative">
              <Button 
                id="notification-button"
                variant="outline" 
                size="icon"
                className="relative"
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell className="h-5 w-5" />
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </Button>

              {showNotifications && (
                <div 
                  id="notification-dropdown"
                  className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-lg border z-50"
                >
                  <div className="p-4 max-h-[500px] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-gray-500 text-center">No notifications</p>
                    ) : (
                      <>
                        {/* Unread Notifications */}
                        {notifications.some(n => !n.read) && (
                          <div className="mb-4">
                            <h3 className="text-sm font-semibold text-gray-500 mb-2">New Updates</h3>
                            {notifications
                              .filter(n => !n.read)
                              .map((notification) => (
                                <NotificationItem 
                                  key={notification.id} 
                                  notification={notification}
                                  onRead={markAsRead}
                                  formatDate={formatDate}
                                />
                              ))}
                          </div>
                        )}

                        {/* Read Notifications */}
                        {notifications.some(n => n.read) && (
                          <div>
                            <div className="flex justify-between items-center mb-2">
                              <h3 className="text-sm font-semibold text-gray-500">Earlier</h3>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={deleteAllReadNotifications}
                                className="text-red-500 hover:text-red-600"
                              >
                                Clear All
                              </Button>
                            </div>
                            {notifications
                              .filter(n => n.read)
                              .slice(0, 10) // Show last 10 read notifications
                              .map((notification) => (
                                <NotificationItem 
                                  key={notification.id} 
                                  notification={notification}
                                  onRead={markAsRead}
                                  formatDate={formatDate}
                                />
                              ))}
                            {notifications.filter(n => n.read).length > 10 && (
                              <p className="text-sm text-gray-500 text-center mt-2">
                                Showing last 10 notifications
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="p-2 border-t">
                    {notifications.some(n => !n.read) && (
                      <Button
                        variant="ghost"
                        className="w-full text-sm"
                        onClick={markAllAsRead}
                      >
                        Mark all as read
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Account Status</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${
                accountStatus === "Active" ? "text-green-600" : "text-yellow-600"
              }`}>
                {accountStatus}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">
                {jobs.filter(job => job.status === "In Progress").length}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pending Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-yellow-600">
                ₹{payments.filter(p => p.status === 'Pending')
                  .reduce((sum, p) => sum + p.amount, 0)
                  .toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Recent Updates Card */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Recent Updates</CardTitle>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500">
                  {notifications.filter(n => !n.read).length} unread
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Unread Notifications */}
              {unreadNotifications.length === 0 ? (
                <p className="text-center text-gray-500">No new updates</p>
              ) : (
                unreadNotifications
                  .slice(0, 5)
                  .map((notification) => (
                    <NotificationItem 
                      key={notification.id} 
                      notification={notification}
                      onRead={markAsRead}
                      formatDate={formatDate}
                    />
                  ))
              )}

              {/* View Seen Updates Button */}
              {readNotifications.length > 0 && (
                <Button 
                  variant="ghost" 
                  className="w-full text-sm"
                  onClick={() => setShowSeenUpdates(!showSeenUpdates)}
                >
                  {showSeenUpdates ? 'Hide Seen Updates' : `View Seen Updates (${readNotifications.length})`}
                </Button>
              )}

              {/* Seen Updates Section */}
              {showSeenUpdates && readNotifications.length > 0 && (
                <div className="mt-4 space-y-4">
                  {readNotifications
                    .slice(0, 5)
                    .map((notification) => (
                      <NotificationItem 
                        key={notification.id} 
                        notification={notification}
                        onRead={markAsRead}
                        formatDate={formatDate}
                      />
                    ))}
                </div>
              )}
              </div>
            </CardContent>
          </Card>

        <Tabs defaultValue="jobs" className="space-y-4">
          <TabsList className="w-full border-b">
            <div className="container mx-auto flex justify-start gap-4">
              <TabsTrigger 
                value="jobs"
                className="px-6 py-3 text-base font-medium data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
              >
                My Jobs
              </TabsTrigger>
              <TabsTrigger 
                value="payments"
                className="px-6 py-3 text-base font-medium data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
              >
                Payments
              </TabsTrigger>
              <TabsTrigger 
                value="documents"
                className="px-6 py-3 text-base font-medium data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
              >
                Documents
              </TabsTrigger>
        </div>
          </TabsList>

          <TabsContent value="jobs" className="py-4">
            <Card className="shadow-md">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>My Jobs</CardTitle>
                  <Button onClick={() => setJobRequestDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Request New Job
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Job Requests Section */}
                {jobRequests.length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold mb-4">Job Requests</h3>
                    <div className="space-y-4">
                      {jobRequests.map((request) => (
                        <div
                          key={request.id}
                          className="border rounded-lg p-4"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-medium">{request.title}</h4>
                              <p className="text-sm text-gray-500">Type: {request.type}</p>
                              <p className="text-sm text-gray-500">Deadline: {formatSimpleDate(request.deadline)}</p>
                              {request.budget && (
                                <p className="text-sm text-gray-500">Budget: ₹{request.budget}</p>
                              )}
                            </div>
                            <span className={`px-3 py-1 rounded-full text-sm ${
                              request.status === 'Approved' 
                                ? 'bg-green-100 text-green-800'
                                : request.status === 'Rejected'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {request.status}
                            </span>
                          </div>
                          {request.description && (
                            <div className="mt-3 text-sm text-gray-600">
                              <p>{request.description}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active Jobs Section */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Active Jobs</h3>
                  <div className="space-y-6">
                    {jobs.length === 0 ? (
                      <p className="text-center text-gray-500">No active jobs found</p>
                    ) : (
                      jobs.map((job) => (
                        <div
                          key={job.id}
                          className="border rounded-lg p-4 space-y-4"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="font-semibold">{job.name}</h3>
                              <p className="text-sm text-gray-500">Deadline: {formatSimpleDate(job.deadline)}</p>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className={`px-2 py-1 rounded-full text-xs ${
                                job.status === 'Completed' 
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}>
                                {job.status}
                              </span>
                              <span className="text-sm font-medium">
                                ₹{job.amount?.toLocaleString() || 0}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between text-sm text-gray-500">
                              <span>Progress</span>
                              <span>{job.progress}%</span>
                            </div>
                            <Progress value={job.progress} className="w-full" />
                          </div>

                          {/* Latest Update Section - Updated to handle both cases */}
                          {(job.latestUpdate || job.latest_update) && (
                            <div className="bg-gray-50 p-3 rounded-md">
                              <div className="flex items-start gap-2">
                                <RefreshCw className="h-4 w-4 text-blue-500 mt-1" />
                                <div>
                                  <p className="text-sm font-medium text-gray-900">Latest Update</p>
                                  <p className="text-sm text-gray-600">
                                    {job.latestUpdate || job.latest_update}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments" className="py-4">
            <Card className="shadow-md">
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>
                          {formatPaymentDate(payment.date || payment.created_at)}
                        </TableCell>
                        <TableCell>{payment.description}</TableCell>
                        <TableCell>₹{payment.amount.toLocaleString()}</TableCell>
                        <TableCell>
                          <span className={`inline-block px-3 py-1.5 text-base font-medium rounded-full ${
                            payment.status === 'Paid' 
                              ? 'bg-green-100 text-green-800 border border-green-200'
                              : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                          }`}>
                            {payment.status}
                          </span>
                          {payment.status === 'Paid' && payment.paymentMethod && (
                            <div className="text-sm text-gray-500 mt-1">
                              via {payment.paymentMethod}
                              {payment.paidAt && (
                                <span className="block">
                                  on {formatSimpleDate(payment.paidAt)}
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {payment.status === 'Pending' ? (
                            <Button 
                              size="sm" 
                              variant="outline"
                              className="flex items-center gap-2"
                              onClick={() => handlePayment(payment.id)}
                            >
                              <IndianRupee className="h-4 w-4" />
                              Pay Now
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex items-center gap-2"
                              onClick={() => handleViewInvoice(payment)}
                            >
                              <FileText className="h-4 w-4" />
                              View Invoice
                            </Button>
                          )}
                        </TableCell>
                    </TableRow>
                    ))}
                    {payments.filter(p => p.status === 'Pending').length > 0 && (
                    <TableRow>
                        <TableCell colSpan={2} className="text-right font-medium text-lg">
                          Total Pending Amount:
                        </TableCell>
                        <TableCell className="font-bold text-xl text-yellow-600">
                          ₹{payments
                            .filter(p => p.status === 'Pending')
                            .reduce((sum, p) => sum + p.amount, 0)
                            .toLocaleString()}
                        </TableCell>
                        <TableCell colSpan={2}></TableCell>
                    </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents" className="py-4">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Required Documents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {requiredDocuments.map((doc) => (
                    <div 
                      key={doc.id} 
                      className="p-4 border rounded-lg space-y-4"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold">{doc.name}</h3>
                          <p className="text-sm text-gray-500">{doc.description}</p>
                          <div className="flex items-center gap-4 mt-2">
                            <p className="text-sm">
                              <span className="text-gray-500">Deadline:</span>{" "}
                              <span className={
                                new Date(doc.deadline) < new Date() 
                                  ? "text-red-600 font-medium" 
                                  : "text-gray-600"
                              }>
                                {formatSimpleDate(doc.deadline)}
                              </span>
                            </p>
                            {doc.uploadedAt && (
                              <p className="text-sm">
                                <span className="text-gray-500">Uploaded:</span>{" "}
                                <span className="text-gray-600">
                                  {formatSimpleDate(doc.uploadedAt)}
                                </span>
                              </p>
                            )}
                  </div>
                          {doc.feedback && (
                            <p className="text-sm text-red-600 mt-2">
                              Feedback: {doc.feedback}
                            </p>
                          )}
                  </div>
                        <div className="flex items-center gap-3">
                          <span className={`inline-block px-3 py-1.5 text-base font-medium rounded-full ${
                            doc.status === 'Verified' 
                              ? 'bg-green-100 text-green-800 border border-green-200'
                              : doc.status === 'Uploaded'
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : doc.status === 'Rejected'
                              ? 'bg-red-100 text-red-800 border border-red-200'
                              : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                          }`}>
                            {doc.status}
                          </span>
                          {doc.status === 'Pending' || doc.status === 'Rejected' ? (
                            <Button asChild size="sm">
                              <label className="cursor-pointer">
                                <input
                                  type="file"
                                  className="hidden"
                                  accept=".pdf"
                                  onChange={(e) => handleFileUpload(e, doc.id)}
                                />
                                <Upload className="h-4 w-4 mr-2" />
                                Upload
                              </label>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {uploadProgress > 0 && doc.status === 'Pending' && (
                        <div className="space-y-2">
                          <Progress value={uploadProgress} className="w-full" />
                          <p className="text-sm text-gray-500 text-center">
                            Uploading... {uploadProgress}%
                          </p>
                  </div>
                      )}
                  </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
      <PaymentDialog 
        open={paymentDialogOpen}
        onOpenChangeAction={setPaymentDialogOpen}
        amount={selectedPayment?.amount || 0}
        description={selectedPayment?.description || ''}
        onConfirmAction={(method) => selectedPayment && handlePayment(selectedPayment.id)}
      />
      <JobRequestDialog 
        open={jobRequestDialogOpen}
        onOpenChangeAction={setJobRequestDialogOpen}
        onSubmitAction={handleJobRequest}
        jobTypes={[
          "Tax Filing",
          "GST Filing",
          "Audit",
          "Accounting",
          "Financial Planning",
          "Business Registration",
          "Compliance",
          "Consulting"
        ]}
      />
      <InvoicePreviewDialog
        open={invoicePreviewOpen}
        onOpenChangeAction={setInvoicePreviewOpen}
        invoiceData={previewInvoice}
        onDownloadAction={async () => {
          if (previewInvoice) {
            try {
              await generateInvoicePDF(previewInvoice)
            } catch (error) {
              console.error('Error generating invoice:', error)
              toast.error('Failed to generate invoice')
            }
          }
        }}
      />
    </div>
  )
}

