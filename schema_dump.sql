--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.5

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: neon_auth; Type: SCHEMA; Schema: -; Owner: neondb_owner
--

CREATE SCHEMA neon_auth;


ALTER SCHEMA neon_auth OWNER TO neondb_owner;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO neondb_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: users_sync; Type: TABLE; Schema: neon_auth; Owner: neondb_owner
--

CREATE TABLE neon_auth.users_sync (
    raw_json jsonb NOT NULL,
    id text GENERATED ALWAYS AS ((raw_json ->> 'id'::text)) STORED NOT NULL,
    name text GENERATED ALWAYS AS ((raw_json ->> 'display_name'::text)) STORED,
    email text GENERATED ALWAYS AS ((raw_json ->> 'primary_email'::text)) STORED,
    created_at timestamp with time zone GENERATED ALWAYS AS (to_timestamp((trunc((((raw_json ->> 'signed_up_at_millis'::text))::bigint)::double precision) / (1000)::double precision))) STORED,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone
);


ALTER TABLE neon_auth.users_sync OWNER TO neondb_owner;

--
-- Name: companies; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.companies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    phone character varying(50),
    company character varying(255),
    trial_start_date timestamp with time zone,
    trial_end_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_updated timestamp with time zone,
    status character varying(50) DEFAULT 'active'::character varying,
    enabled boolean DEFAULT true,
    v2 boolean DEFAULT false,
    daily_report jsonb,
    stack jsonb,
    profile jsonb,
    tasks jsonb,
    assistant_id character varying(255),
    category character varying(100),
    stopped_at timestamp with time zone,
    last_run timestamp with time zone,
    error_type character varying(100),
    error_message text,
    feedback jsonb,
    status_ai_responses jsonb,
    stopbot boolean DEFAULT false,
    stopbots jsonb,
    plan character varying,
    phone_count integer,
    ai_auto_response boolean DEFAULT false,
    ai_delay integer DEFAULT 0,
    api_url text,
    assign_individual boolean DEFAULT false,
    phone_numbers jsonb DEFAULT '[]'::jsonb,
    assistant_ids jsonb DEFAULT '[]'::jsonb
);


ALTER TABLE public.companies OWNER TO neondb_owner;

--
-- Name: TABLE companies; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.companies IS 'Main companies/organizations table';


--
-- Name: active_companies; Type: VIEW; Schema: public; Owner: neondb_owner
--

CREATE VIEW public.active_companies AS
 SELECT id,
    company_id,
    name,
    email,
    phone,
    company,
    trial_start_date,
    trial_end_date,
    created_at,
    updated_at,
    last_updated,
    status,
    enabled,
    v2,
    daily_report,
    stack,
    profile,
    tasks,
    assistant_id,
    category,
    stopped_at,
    last_run,
    error_type,
    error_message,
    feedback
   FROM public.companies
  WHERE (((status)::text = 'active'::text) AND (enabled = true));


ALTER VIEW public.active_companies OWNER TO neondb_owner;

--
-- Name: ai_assign_responses; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.ai_assign_responses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    response_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    keywords jsonb,
    keyword_source character varying(50) DEFAULT 'user'::character varying,
    assigned_employees jsonb,
    description text,
    status character varying(50) DEFAULT 'active'::character varying,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ai_assign_responses OWNER TO neondb_owner;

--
-- Name: ai_document_responses; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.ai_document_responses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    response_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    description text,
    document_urls jsonb,
    document_names jsonb,
    keywords jsonb,
    captions text[] DEFAULT '{}'::text[],
    keyword_source character varying(50) DEFAULT 'user'::character varying,
    status character varying(50) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ai_document_responses OWNER TO neondb_owner;

--
-- Name: ai_image_responses; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.ai_image_responses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    response_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    keywords jsonb,
    image_urls jsonb,
    captions text[] DEFAULT '{}'::text[],
    keyword_source character varying(50) DEFAULT 'user'::character varying,
    status character varying(50) DEFAULT 'active'::character varying,
    description text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ai_image_responses OWNER TO neondb_owner;

--
-- Name: ai_tag_responses; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.ai_tag_responses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    response_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    tags jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    keywords jsonb,
    remove_tags jsonb,
    keyword_source character varying(50) DEFAULT 'user'::character varying,
    tag_action_mode character varying(50) DEFAULT 'add'::character varying,
    status character varying(50) DEFAULT 'active'::character varying,
    description text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ai_tag_responses OWNER TO neondb_owner;

--
-- Name: ai_video_responses; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.ai_video_responses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    response_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    keywords jsonb,
    video_urls jsonb,
    captions text[] DEFAULT '{}'::text[],
    keyword_source character varying(50) DEFAULT 'user'::character varying,
    status character varying(50) DEFAULT 'active'::character varying,
    description text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ai_video_responses OWNER TO neondb_owner;

--
-- Name: ai_voice_responses; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.ai_voice_responses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    response_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    keywords jsonb,
    voice_urls jsonb,
    captions text[] DEFAULT '{}'::text[],
    keyword_source character varying(50) DEFAULT 'user'::character varying,
    status character varying(20) DEFAULT 'active'::character varying,
    description text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ai_voice_responses OWNER TO neondb_owner;

--
-- Name: appointments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.appointments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    appointment_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    contact_id character varying(255),
    title character varying(255),
    description text,
    scheduled_time timestamp with time zone,
    duration_minutes integer,
    status character varying(50) DEFAULT 'scheduled'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    metadata jsonb,
    staff_assigned jsonb,
    appointment_type character varying(50)
);


ALTER TABLE public.appointments OWNER TO neondb_owner;

--
-- Name: archived_messages; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.archived_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    original_message_id uuid,
    company_id character varying(255) NOT NULL,
    archived_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    message_data jsonb
);


ALTER TABLE public.archived_messages OWNER TO neondb_owner;

--
-- Name: assignment_counts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.assignment_counts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    assignment_type character varying(50) NOT NULL,
    counts jsonb DEFAULT '{}'::jsonb,
    total integer DEFAULT 0,
    last_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    month_key character varying(10) NOT NULL
);


ALTER TABLE public.assignment_counts OWNER TO neondb_owner;

--
-- Name: assignment_logs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.assignment_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    phone_index integer NOT NULL,
    contact_id character varying(255) NOT NULL,
    logs text[],
    "timestamp" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.assignment_logs OWNER TO neondb_owner;

--
-- Name: assignments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.assignments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    assignment_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    employee_id character varying(255),
    contact_id character varying(255),
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'active'::character varying,
    notes text,
    metadata jsonb,
    month_key character varying(7) NOT NULL,
    phone_index integer,
    assignment_type character varying(50),
    employee_role character varying(50),
    weightage_used integer
);


ALTER TABLE public.assignments OWNER TO neondb_owner;

--
-- Name: TABLE assignments; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.assignments IS 'Contact assignments to employees';


--
-- Name: batches; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.batches (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    batch_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255),
    status character varying(50) DEFAULT 'pending'::character varying,
    total_count integer DEFAULT 0,
    processed_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone
);


ALTER TABLE public.batches OWNER TO neondb_owner;

--
-- Name: bot_state; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.bot_state (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    bot_name character varying(255),
    state jsonb,
    last_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    current_index integer
);


ALTER TABLE public.bot_state OWNER TO neondb_owner;

--
-- Name: contacts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.contacts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    contact_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255),
    contact_name character varying(255),
    phone character varying(50),
    email character varying(255),
    thread_id character varying(255),
    profile jsonb,
    points integer DEFAULT 0,
    tags jsonb,
    reaction character varying(100),
    reaction_timestamp timestamp with time zone,
    last_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    edited boolean DEFAULT false,
    edited_at timestamp with time zone,
    whapi_token character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    additional_emails jsonb DEFAULT '[]'::jsonb,
    address1 text,
    assigned_to character varying(255),
    business_id character varying(255),
    chat_data jsonb,
    is_group boolean DEFAULT false,
    unread_count integer DEFAULT 0,
    last_message jsonb,
    custom_fields jsonb,
    company character varying(255),
    multi_assign jsonb DEFAULT '[]'::jsonb,
    not_spam boolean DEFAULT true,
    profile_pic_url text,
    pinned boolean DEFAULT false,
    customer_message text,
    storage_requirements jsonb,
    form_submission jsonb,
    phone_indexes jsonb DEFAULT '[]'::jsonb,
    personal_id character(255),
    last_name character varying(255),
    notes text,
    chat_id character varying(255),
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    location_id character varying(255),
    branch character varying(255),
    expiry_date character varying(255),
    vehiclenumber character varying(255),
    vehicle_number character varying(255),
    ic character varying(255)
);


ALTER TABLE public.contacts OWNER TO neondb_owner;

--
-- Name: TABLE contacts; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.contacts IS 'Customer contacts for each company';


--
-- Name: employees; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.employees (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id character varying(255),
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    role character varying(100),
    current_index integer DEFAULT 0,
    last_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    active boolean DEFAULT true,
    assigned_contacts integer DEFAULT 0,
    phone_number character varying(50),
    phone_access jsonb,
    weightages jsonb,
    company character varying(255),
    image_url text,
    notes text,
    quota_leads integer DEFAULT 0,
    view_employees jsonb,
    invoice_number character varying(255),
    emp_group character varying(255)
);


ALTER TABLE public.employees OWNER TO neondb_owner;

--
-- Name: TABLE employees; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.employees IS 'Company employees and staff';


--
-- Name: messages; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    message_id character varying(255),
    company_id character varying(255) NOT NULL,
    contact_id character varying(255),
    thread_id character varying(255),
    customer_phone character varying(50),
    content text,
    message_type character varying(50),
    media_url text,
    "timestamp" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    logs jsonb,
    tags jsonb,
    reaction character varying(100),
    reaction_timestamp timestamp with time zone,
    edited boolean DEFAULT false,
    edited_at timestamp with time zone,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    duration integer,
    direction character varying(20),
    status character varying(50) DEFAULT 'sent'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    from_me boolean DEFAULT false,
    chat_id character varying(255),
    author character varying(255),
    media_data text,
    media_metadata jsonb,
    phone_index integer,
    quoted_message jsonb,
    CONSTRAINT messages_direction_check CHECK (((direction)::text = ANY (ARRAY[('inbound'::character varying)::text, ('outbound'::character varying)::text])))
);


ALTER TABLE public.messages OWNER TO neondb_owner;

--
-- Name: TABLE messages; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.messages IS 'All messages (WhatsApp and other channels)';


--
-- Name: company_stats; Type: VIEW; Schema: public; Owner: neondb_owner
--

CREATE VIEW public.company_stats AS
 SELECT c.company_id,
    c.name,
    count(DISTINCT co.contact_id) AS total_contacts,
    count(DISTINCT m.id) AS total_messages,
    count(DISTINCT e.employee_id) AS total_employees
   FROM (((public.companies c
     LEFT JOIN public.contacts co ON (((c.company_id)::text = (co.company_id)::text)))
     LEFT JOIN public.messages m ON (((c.company_id)::text = (m.company_id)::text)))
     LEFT JOIN public.employees e ON (((c.company_id)::text = (e.company_id)::text)))
  GROUP BY c.company_id, c.name;


ALTER VIEW public.company_stats OWNER TO neondb_owner;

--
-- Name: company_tags; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.company_tags (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.company_tags OWNER TO neondb_owner;

--
-- Name: duplicate_check_logs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.duplicate_check_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255),
    check_type character varying(100),
    original_id character varying(255),
    duplicate_id character varying(255),
    similarity_score numeric(3,2),
    action_taken character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.duplicate_check_logs OWNER TO neondb_owner;

--
-- Name: employee_monthly_assignments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.employee_monthly_assignments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    employee_id uuid NOT NULL,
    month_key character varying(7) NOT NULL,
    assignments_count integer DEFAULT 0 NOT NULL,
    last_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.employee_monthly_assignments OWNER TO neondb_owner;

--
-- Name: error_logs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.error_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    message_id character varying(255),
    error_type character varying(255),
    error_message text,
    stack_trace text,
    "timestamp" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.error_logs OWNER TO neondb_owner;

--
-- Name: feedback; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.feedback (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    feedback_id character varying(255) NOT NULL,
    company_id character varying(255),
    user_id character varying(255),
    type character varying(50),
    rating integer,
    comments text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT feedback_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


ALTER TABLE public.feedback OWNER TO neondb_owner;

--
-- Name: followup_messages; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.followup_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    template_id character varying(255) NOT NULL,
    message text NOT NULL,
    day_number integer NOT NULL,
    sequence integer NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    document jsonb,
    image jsonb,
    video jsonb,
    delay_after jsonb,
    specific_numbers jsonb,
    use_scheduled_time boolean DEFAULT false,
    scheduled_time character varying(50),
    add_tags text[] DEFAULT '{}'::text[],
    remove_tags text[] DEFAULT '{}'::text[]
);


ALTER TABLE public.followup_messages OWNER TO neondb_owner;

--
-- Name: followup_templates; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.followup_templates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    template_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    trigger_keywords text[] DEFAULT '{}'::text[],
    trigger_tags text[] DEFAULT '{}'::text[],
    keyword_source character varying(50) DEFAULT 'bot'::character varying,
    status character varying(50) DEFAULT 'active'::character varying,
    content text NOT NULL,
    delay_hours integer DEFAULT 24
);


ALTER TABLE public.followup_templates OWNER TO neondb_owner;

--
-- Name: TABLE followup_templates; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.followup_templates IS 'Automated follow-up message templates';


--
-- Name: instruction_templates; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.instruction_templates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    instructions text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.instruction_templates OWNER TO neondb_owner;

--
-- Name: merchants; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.merchants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    merchant_id character varying(255) NOT NULL,
    company_id character varying(255),
    name character varying(255),
    contact_info jsonb,
    settings jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.merchants OWNER TO neondb_owner;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    user_id character varying(255),
    title character varying(255),
    message text,
    type character varying(50),
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    message_data jsonb
);


ALTER TABLE public.notifications OWNER TO neondb_owner;

--
-- Name: phone_status; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.phone_status (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    phone_number character varying(50) NOT NULL,
    status character varying(50),
    last_seen timestamp with time zone,
    metadata jsonb,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.phone_status OWNER TO neondb_owner;

--
-- Name: pinned_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.pinned_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    item_type character varying(50),
    item_id character varying(255),
    pinned_by character varying(255),
    pinned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.pinned_items OWNER TO neondb_owner;

--
-- Name: pricing; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.pricing (
    id integer NOT NULL,
    company_id character varying(50),
    category character varying(50) NOT NULL,
    pricing_data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.pricing OWNER TO neondb_owner;

--
-- Name: pricing_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.pricing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pricing_id_seq OWNER TO neondb_owner;

--
-- Name: pricing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.pricing_id_seq OWNED BY public.pricing.id;


--
-- Name: private_notes; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.private_notes (
    id uuid NOT NULL,
    company_id character varying(255) NOT NULL,
    contact_id character varying(255) NOT NULL,
    text text NOT NULL,
    "from" character varying(255) NOT NULL,
    from_email character varying(255) DEFAULT ''::character varying NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    type character varying(100) DEFAULT 'privateNote'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.private_notes OWNER TO neondb_owner;

--
-- Name: quick_replies; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.quick_replies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    keyword character varying(255) NOT NULL,
    text text,
    type character varying(50) DEFAULT 'all'::character varying,
    documents jsonb DEFAULT '[]'::jsonb,
    images jsonb DEFAULT '[]'::jsonb,
    videos jsonb DEFAULT '[]'::jsonb,
    created_by character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'active'::character varying
);


ALTER TABLE public.quick_replies OWNER TO neondb_owner;

--
-- Name: recent_messages; Type: VIEW; Schema: public; Owner: neondb_owner
--

CREATE VIEW public.recent_messages AS
 SELECT m.id,
    m.message_id,
    m.company_id,
    m.contact_id,
    m.thread_id,
    m.customer_phone,
    m.content,
    m.message_type,
    m.media_url,
    m."timestamp",
    m.logs,
    m.tags,
    m.reaction,
    m.reaction_timestamp,
    m.edited,
    m.edited_at,
    m.start_time,
    m.end_time,
    m.duration,
    m.direction,
    m.status,
    m.created_at,
    c.name AS contact_name,
    co.name AS company_name
   FROM ((public.messages m
     LEFT JOIN public.contacts c ON ((((m.contact_id)::text = (c.contact_id)::text) AND ((m.company_id)::text = (c.company_id)::text))))
     LEFT JOIN public.companies co ON (((m.company_id)::text = (co.company_id)::text)))
  WHERE (m."timestamp" >= (CURRENT_TIMESTAMP - '7 days'::interval))
  ORDER BY m."timestamp" DESC;


ALTER VIEW public.recent_messages OWNER TO neondb_owner;

--
-- Name: scheduled_messages; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.scheduled_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    schedule_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    contact_id character varying(255),
    message_content text,
    media_url character varying(500),
    scheduled_time timestamp with time zone NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    attempt_count integer DEFAULT 0,
    last_attempt timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    sent_at timestamp with time zone,
    chat_id character varying(255),
    message_id character varying(255),
    phone_index integer DEFAULT 0,
    is_media boolean DEFAULT false,
    document_url character varying(500),
    file_name character varying(255),
    caption text,
    chat_ids jsonb,
    batch_quantity integer,
    repeat_interval integer,
    repeat_unit character varying(20),
    message_delays jsonb,
    infinite_loop boolean DEFAULT false,
    min_delay integer,
    max_delay integer,
    activate_sleep boolean DEFAULT false,
    sleep_after_messages integer,
    sleep_duration integer,
    active_hours jsonb,
    batch_index integer,
    from_me boolean DEFAULT true,
    messages jsonb,
    skipped_reason text,
    skipped_at timestamp with time zone
);


ALTER TABLE public.scheduled_messages OWNER TO neondb_owner;

--
-- Name: TABLE scheduled_messages; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.scheduled_messages IS 'Messages scheduled to be sent later';


--
-- Name: sent_followups; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.sent_followups (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    contact_id character varying(255) NOT NULL,
    template_id character varying(255),
    sent_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    message_id character varying(255)
);


ALTER TABLE public.sent_followups OWNER TO neondb_owner;

--
-- Name: TABLE sent_followups; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.sent_followups IS 'Tracking of sent follow-up messages';


--
-- Name: sent_messages; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.sent_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    chat_id character varying(255) NOT NULL,
    identifier character varying(255) NOT NULL,
    sent_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    message_index integer,
    message_content text,
    message_type character varying(50),
    media_url character varying(500),
    document_url character varying(500)
);


ALTER TABLE public.sent_messages OWNER TO neondb_owner;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id character varying(255) NOT NULL,
    company_id character varying(255),
    data jsonb,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.sessions OWNER TO neondb_owner;

--
-- Name: settings; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255) NOT NULL,
    setting_type character varying(100) NOT NULL,
    setting_key character varying(255) NOT NULL,
    setting_value jsonb,
    last_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.settings OWNER TO neondb_owner;

--
-- Name: TABLE settings; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.settings IS 'Company-specific configuration settings';


--
-- Name: system_config; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.system_config (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    config_key character varying(255) NOT NULL,
    config_value jsonb,
    description text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.system_config OWNER TO neondb_owner;

--
-- Name: threads; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.threads (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    thread_id character varying(255) NOT NULL,
    company_id character varying(255) NOT NULL,
    contact_id character varying(255),
    status character varying(50) DEFAULT 'active'::character varying,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_activity timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.threads OWNER TO neondb_owner;

--
-- Name: usage_logs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.usage_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id character varying(255),
    feature character varying(100),
    usage_count integer DEFAULT 1,
    date date DEFAULT CURRENT_DATE,
    metadata jsonb
);


ALTER TABLE public.usage_logs OWNER TO neondb_owner;

--
-- Name: users; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id character varying(255) NOT NULL,
    company_id character varying(255),
    name character varying(255),
    email character varying(255),
    phone character varying(50),
    role character varying(100),
    profile jsonb,
    last_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    active boolean DEFAULT true,
    password character varying(255),
    thread_id character varying(255)
);


ALTER TABLE public.users OWNER TO neondb_owner;

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.users IS 'System users with access permissions';


--
-- Name: pricing id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.pricing ALTER COLUMN id SET DEFAULT nextval('public.pricing_id_seq'::regclass);


--
-- Name: users_sync users_sync_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neondb_owner
--

ALTER TABLE ONLY neon_auth.users_sync
    ADD CONSTRAINT users_sync_pkey PRIMARY KEY (id);


--
-- Name: ai_assign_responses ai_assign_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_assign_responses
    ADD CONSTRAINT ai_assign_responses_pkey PRIMARY KEY (id);


--
-- Name: ai_assign_responses ai_assign_responses_response_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_assign_responses
    ADD CONSTRAINT ai_assign_responses_response_id_key UNIQUE (response_id);


--
-- Name: ai_document_responses ai_document_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_document_responses
    ADD CONSTRAINT ai_document_responses_pkey PRIMARY KEY (id);


--
-- Name: ai_document_responses ai_document_responses_response_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_document_responses
    ADD CONSTRAINT ai_document_responses_response_id_key UNIQUE (response_id);


--
-- Name: ai_image_responses ai_image_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_image_responses
    ADD CONSTRAINT ai_image_responses_pkey PRIMARY KEY (id);


--
-- Name: ai_image_responses ai_image_responses_response_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_image_responses
    ADD CONSTRAINT ai_image_responses_response_id_key UNIQUE (response_id);


--
-- Name: ai_tag_responses ai_tag_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_tag_responses
    ADD CONSTRAINT ai_tag_responses_pkey PRIMARY KEY (id);


--
-- Name: ai_tag_responses ai_tag_responses_response_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_tag_responses
    ADD CONSTRAINT ai_tag_responses_response_id_key UNIQUE (response_id);


--
-- Name: ai_video_responses ai_video_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_video_responses
    ADD CONSTRAINT ai_video_responses_pkey PRIMARY KEY (id);


--
-- Name: ai_video_responses ai_video_responses_response_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_video_responses
    ADD CONSTRAINT ai_video_responses_response_id_key UNIQUE (response_id);


--
-- Name: ai_voice_responses ai_voice_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_voice_responses
    ADD CONSTRAINT ai_voice_responses_pkey PRIMARY KEY (id);


--
-- Name: ai_voice_responses ai_voice_responses_response_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_voice_responses
    ADD CONSTRAINT ai_voice_responses_response_id_key UNIQUE (response_id);


--
-- Name: appointments appointments_appointment_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_appointment_id_key UNIQUE (appointment_id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: archived_messages archived_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.archived_messages
    ADD CONSTRAINT archived_messages_pkey PRIMARY KEY (id);


--
-- Name: assignment_counts assignment_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignment_counts
    ADD CONSTRAINT assignment_counts_pkey PRIMARY KEY (company_id, assignment_type, month_key);


--
-- Name: assignment_counts assignment_counts_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignment_counts
    ADD CONSTRAINT assignment_counts_unique UNIQUE (company_id, assignment_type);


--
-- Name: assignment_logs assignment_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignment_logs
    ADD CONSTRAINT assignment_logs_pkey PRIMARY KEY (id);


--
-- Name: assignments assignments_assignment_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_assignment_id_key UNIQUE (assignment_id);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id, month_key);


--
-- Name: batches batches_batch_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_batch_id_key UNIQUE (batch_id);


--
-- Name: batches batches_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_pkey PRIMARY KEY (id);


--
-- Name: bot_state bot_state_company_id_bot_name_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.bot_state
    ADD CONSTRAINT bot_state_company_id_bot_name_key UNIQUE (company_id, bot_name);


--
-- Name: bot_state bot_state_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.bot_state
    ADD CONSTRAINT bot_state_pkey PRIMARY KEY (id);


--
-- Name: companies companies_company_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_company_id_key UNIQUE (company_id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_tags company_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_tags
    ADD CONSTRAINT company_tags_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_contact_id_company_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_contact_id_company_id_key UNIQUE (contact_id, company_id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: duplicate_check_logs duplicate_check_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.duplicate_check_logs
    ADD CONSTRAINT duplicate_check_logs_pkey PRIMARY KEY (id);


--
-- Name: employee_monthly_assignments employee_monthly_assignments_employee_id_month_key_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employee_monthly_assignments
    ADD CONSTRAINT employee_monthly_assignments_employee_id_month_key_key UNIQUE (employee_id, month_key);


--
-- Name: employee_monthly_assignments employee_monthly_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employee_monthly_assignments
    ADD CONSTRAINT employee_monthly_assignments_pkey PRIMARY KEY (id);


--
-- Name: employees employees_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_id_key UNIQUE (employee_id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: error_logs error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_feedback_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_feedback_id_key UNIQUE (feedback_id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: followup_messages followup_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.followup_messages
    ADD CONSTRAINT followup_messages_pkey PRIMARY KEY (id);


--
-- Name: followup_templates followup_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.followup_templates
    ADD CONSTRAINT followup_templates_pkey PRIMARY KEY (id);


--
-- Name: followup_templates followup_templates_template_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.followup_templates
    ADD CONSTRAINT followup_templates_template_id_key UNIQUE (template_id);


--
-- Name: instruction_templates instruction_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.instruction_templates
    ADD CONSTRAINT instruction_templates_pkey PRIMARY KEY (id);


--
-- Name: merchants merchants_merchant_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_merchant_id_key UNIQUE (merchant_id);


--
-- Name: merchants merchants_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_pkey PRIMARY KEY (id);


--
-- Name: messages messages_message_id_company_id_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_message_id_company_id_unique UNIQUE (message_id, company_id);


--
-- Name: messages messages_message_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_message_id_key UNIQUE (message_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: phone_status phone_status_company_id_phone_number_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.phone_status
    ADD CONSTRAINT phone_status_company_id_phone_number_key UNIQUE (company_id, phone_number);


--
-- Name: phone_status phone_status_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.phone_status
    ADD CONSTRAINT phone_status_pkey PRIMARY KEY (id);


--
-- Name: pinned_items pinned_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.pinned_items
    ADD CONSTRAINT pinned_items_pkey PRIMARY KEY (id);


--
-- Name: pricing pricing_company_id_category_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.pricing
    ADD CONSTRAINT pricing_company_id_category_key UNIQUE (company_id, category);


--
-- Name: pricing pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.pricing
    ADD CONSTRAINT pricing_pkey PRIMARY KEY (id);


--
-- Name: private_notes private_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.private_notes
    ADD CONSTRAINT private_notes_pkey PRIMARY KEY (id);


--
-- Name: quick_replies quick_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.quick_replies
    ADD CONSTRAINT quick_replies_pkey PRIMARY KEY (id);


--
-- Name: scheduled_messages scheduled_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.scheduled_messages
    ADD CONSTRAINT scheduled_messages_pkey PRIMARY KEY (id);


--
-- Name: sent_followups sent_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sent_followups
    ADD CONSTRAINT sent_followups_pkey PRIMARY KEY (id);


--
-- Name: sent_followups sent_followups_unique_contact_template; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sent_followups
    ADD CONSTRAINT sent_followups_unique_contact_template UNIQUE (company_id, contact_id, template_id);


--
-- Name: sent_messages sent_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sent_messages
    ADD CONSTRAINT sent_messages_pkey PRIMARY KEY (company_id, chat_id, identifier);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_session_id_key UNIQUE (session_id);


--
-- Name: settings settings_company_id_setting_type_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_company_id_setting_type_setting_key_key UNIQUE (company_id, setting_type, setting_key);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: system_config system_config_config_key_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_config_key_key UNIQUE (config_key);


--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (id);


--
-- Name: threads threads_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id);


--
-- Name: threads threads_thread_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_thread_id_key UNIQUE (thread_id);


--
-- Name: usage_logs usage_logs_company_id_feature_date_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_company_id_feature_date_key UNIQUE (company_id, feature, date);


--
-- Name: usage_logs usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_user_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_user_id_key UNIQUE (user_id);


--
-- Name: users_sync_deleted_at_idx; Type: INDEX; Schema: neon_auth; Owner: neondb_owner
--

CREATE INDEX users_sync_deleted_at_idx ON neon_auth.users_sync USING btree (deleted_at);


--
-- Name: idx_ai_assign_responses_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_assign_responses_company_id ON public.ai_assign_responses USING btree (company_id);


--
-- Name: idx_ai_image_responses_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_image_responses_company_id ON public.ai_image_responses USING btree (company_id);


--
-- Name: idx_ai_tag_responses_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_tag_responses_company_id ON public.ai_tag_responses USING btree (company_id);


--
-- Name: idx_ai_video_responses_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_video_responses_company_id ON public.ai_video_responses USING btree (company_id);


--
-- Name: idx_ai_voice_responses_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_voice_responses_company_id ON public.ai_voice_responses USING btree (company_id);


--
-- Name: idx_appointments_metadata; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_appointments_metadata ON public.appointments USING gin (metadata);


--
-- Name: idx_assignment_counts_company_type; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignment_counts_company_type ON public.assignment_counts USING btree (company_id, assignment_type);


--
-- Name: idx_assignment_counts_month; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignment_counts_month ON public.assignment_counts USING btree (month_key);


--
-- Name: idx_assignment_logs_company_contact; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignment_logs_company_contact ON public.assignment_logs USING btree (company_id, contact_id);


--
-- Name: idx_assignment_logs_timestamp; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignment_logs_timestamp ON public.assignment_logs USING btree ("timestamp");


--
-- Name: idx_assignments_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignments_company_id ON public.assignments USING btree (company_id);


--
-- Name: idx_assignments_company_month; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignments_company_month ON public.assignments USING btree (company_id, month_key);


--
-- Name: idx_assignments_contact; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignments_contact ON public.assignments USING btree (contact_id);


--
-- Name: idx_assignments_employee_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignments_employee_id ON public.assignments USING btree (employee_id);


--
-- Name: idx_assignments_employee_month; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignments_employee_month ON public.assignments USING btree (employee_id, month_key);


--
-- Name: idx_assignments_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_assignments_status ON public.assignments USING btree (status);


--
-- Name: idx_batches_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_batches_company_id ON public.batches USING btree (company_id);


--
-- Name: idx_bot_state_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_bot_state_company_id ON public.bot_state USING btree (company_id);


--
-- Name: idx_companies_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_companies_company_id ON public.companies USING btree (company_id);


--
-- Name: idx_companies_email; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_companies_email ON public.companies USING btree (email);


--
-- Name: idx_companies_profile; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_companies_profile ON public.companies USING gin (profile);


--
-- Name: idx_companies_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_companies_status ON public.companies USING btree (status);


--
-- Name: idx_companies_tasks; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_companies_tasks ON public.companies USING gin (tasks);


--
-- Name: idx_company_tags_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX idx_company_tags_unique ON public.company_tags USING btree (company_id, name);


--
-- Name: idx_contacts_company_created_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_company_created_at ON public.contacts USING btree (company_id, created_at);


--
-- Name: idx_contacts_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_company_id ON public.contacts USING btree (company_id);


--
-- Name: idx_contacts_contact_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_contact_id ON public.contacts USING btree (contact_id);


--
-- Name: idx_contacts_contact_name; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_contact_name ON public.contacts USING btree (contact_name);


--
-- Name: idx_contacts_created_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_created_at ON public.contacts USING btree (created_at);


--
-- Name: idx_contacts_last_updated; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_last_updated ON public.contacts USING btree (last_updated);


--
-- Name: idx_contacts_name; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_name ON public.contacts USING btree (name);


--
-- Name: idx_contacts_phone; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_phone ON public.contacts USING btree (phone);


--
-- Name: idx_contacts_phone_company; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_phone_company ON public.contacts USING btree (phone, company_id);


--
-- Name: idx_contacts_profile; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_profile ON public.contacts USING gin (profile);


--
-- Name: idx_contacts_tags; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_contacts_tags ON public.contacts USING gin (tags);


--
-- Name: idx_employees_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_employees_company_id ON public.employees USING btree (company_id);


--
-- Name: idx_employees_email; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_employees_email ON public.employees USING btree (email);


--
-- Name: idx_error_logs_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_error_logs_company_id ON public.error_logs USING btree (company_id);


--
-- Name: idx_error_logs_timestamp; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_error_logs_timestamp ON public.error_logs USING btree ("timestamp");


--
-- Name: idx_followup_messages_template_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_followup_messages_template_id ON public.followup_messages USING btree (template_id);


--
-- Name: idx_followup_templates_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_followup_templates_company_id ON public.followup_templates USING btree (company_id);


--
-- Name: idx_instruction_templates_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_instruction_templates_company_id ON public.instruction_templates USING btree (company_id);


--
-- Name: idx_messages_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_messages_company_id ON public.messages USING btree (company_id);


--
-- Name: idx_messages_contact_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_messages_contact_id ON public.messages USING btree (contact_id);


--
-- Name: idx_messages_logs; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_messages_logs ON public.messages USING gin (logs);


--
-- Name: idx_messages_message_type; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_messages_message_type ON public.messages USING btree (message_type);


--
-- Name: idx_messages_tags; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_messages_tags ON public.messages USING gin (tags);


--
-- Name: idx_messages_thread_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_messages_thread_id ON public.messages USING btree (thread_id);


--
-- Name: idx_messages_timestamp; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_messages_timestamp ON public.messages USING btree ("timestamp");


--
-- Name: idx_notifications_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_notifications_company_id ON public.notifications USING btree (company_id);


--
-- Name: idx_notifications_read; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_notifications_read ON public.notifications USING btree (read);


--
-- Name: idx_phone_status_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_phone_status_company_id ON public.phone_status USING btree (company_id);


--
-- Name: idx_pricing_company; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_pricing_company ON public.pricing USING btree (company_id);


--
-- Name: idx_pricing_data; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_pricing_data ON public.pricing USING gin (pricing_data);


--
-- Name: idx_private_notes_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_private_notes_company_id ON public.private_notes USING btree (company_id);


--
-- Name: idx_private_notes_contact_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_private_notes_contact_id ON public.private_notes USING btree (contact_id);


--
-- Name: idx_private_notes_timestamp; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_private_notes_timestamp ON public.private_notes USING btree ("timestamp");


--
-- Name: idx_quick_replies_category; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quick_replies_category ON public.quick_replies USING btree (category);


--
-- Name: idx_quick_replies_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quick_replies_company_id ON public.quick_replies USING btree (company_id);


--
-- Name: idx_quick_replies_keyword; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quick_replies_keyword ON public.quick_replies USING btree (keyword);


--
-- Name: idx_scheduled_messages_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_scheduled_messages_company_id ON public.scheduled_messages USING btree (company_id);


--
-- Name: idx_scheduled_messages_messages; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_scheduled_messages_messages ON public.scheduled_messages USING gin (messages);


--
-- Name: idx_scheduled_messages_scheduled_time; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_scheduled_messages_scheduled_time ON public.scheduled_messages USING btree (scheduled_time);


--
-- Name: idx_scheduled_messages_skipped_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_scheduled_messages_skipped_at ON public.scheduled_messages USING btree (skipped_at);


--
-- Name: idx_scheduled_messages_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_scheduled_messages_status ON public.scheduled_messages USING btree (status);


--
-- Name: idx_sent_followups_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_sent_followups_company_id ON public.sent_followups USING btree (company_id);


--
-- Name: idx_sessions_expires_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_sessions_expires_at ON public.sessions USING btree (expires_at);


--
-- Name: idx_sessions_session_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_sessions_session_id ON public.sessions USING btree (session_id);


--
-- Name: idx_settings_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_settings_company_id ON public.settings USING btree (company_id);


--
-- Name: idx_settings_lookup; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_settings_lookup ON public.settings USING btree (company_id, setting_type, setting_key);


--
-- Name: idx_settings_type_key; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_settings_type_key ON public.settings USING btree (setting_type, setting_key);


--
-- Name: idx_usage_logs_company_id_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_usage_logs_company_id_date ON public.usage_logs USING btree (company_id, date);


--
-- Name: idx_users_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_users_company_id ON public.users USING btree (company_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: companies update_companies_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: followup_templates update_followup_templates_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER update_followup_templates_updated_at BEFORE UPDATE ON public.followup_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ai_assign_responses ai_assign_responses_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_assign_responses
    ADD CONSTRAINT ai_assign_responses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: ai_document_responses ai_document_responses_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_document_responses
    ADD CONSTRAINT ai_document_responses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: ai_image_responses ai_image_responses_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_image_responses
    ADD CONSTRAINT ai_image_responses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: ai_tag_responses ai_tag_responses_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_tag_responses
    ADD CONSTRAINT ai_tag_responses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: ai_video_responses ai_video_responses_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_video_responses
    ADD CONSTRAINT ai_video_responses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: ai_voice_responses ai_voice_responses_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_voice_responses
    ADD CONSTRAINT ai_voice_responses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: appointments appointments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: appointments appointments_contact_id_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_contact_id_company_id_fkey FOREIGN KEY (contact_id, company_id) REFERENCES public.contacts(contact_id, company_id);


--
-- Name: assignment_counts assignment_counts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignment_counts
    ADD CONSTRAINT assignment_counts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: assignment_logs assignment_logs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignment_logs
    ADD CONSTRAINT assignment_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: assignments assignments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: assignments assignments_contact_id_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_contact_id_company_id_fkey FOREIGN KEY (contact_id, company_id) REFERENCES public.contacts(contact_id, company_id);


--
-- Name: assignments assignments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: batches batches_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: bot_state bot_state_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.bot_state
    ADD CONSTRAINT bot_state_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: contacts contacts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: duplicate_check_logs duplicate_check_logs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.duplicate_check_logs
    ADD CONSTRAINT duplicate_check_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id);


--
-- Name: employees employees_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: error_logs error_logs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id);


--
-- Name: feedback feedback_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id);


--
-- Name: employee_monthly_assignments fk_employee_id; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employee_monthly_assignments
    ADD CONSTRAINT fk_employee_id FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: followup_templates followup_templates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.followup_templates
    ADD CONSTRAINT followup_templates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: merchants merchants_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id);


--
-- Name: messages messages_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: messages messages_contact_id_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_contact_id_company_id_fkey FOREIGN KEY (contact_id, company_id) REFERENCES public.contacts(contact_id, company_id) ON DELETE CASCADE;


--
-- Name: notifications notifications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: phone_status phone_status_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.phone_status
    ADD CONSTRAINT phone_status_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: pinned_items pinned_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.pinned_items
    ADD CONSTRAINT pinned_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: pricing pricing_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.pricing
    ADD CONSTRAINT pricing_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id);


--
-- Name: private_notes private_notes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.private_notes
    ADD CONSTRAINT private_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: quick_replies quick_replies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.quick_replies
    ADD CONSTRAINT quick_replies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: scheduled_messages scheduled_messages_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.scheduled_messages
    ADD CONSTRAINT scheduled_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: scheduled_messages scheduled_messages_contact_id_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.scheduled_messages
    ADD CONSTRAINT scheduled_messages_contact_id_company_id_fkey FOREIGN KEY (contact_id, company_id) REFERENCES public.contacts(contact_id, company_id);


--
-- Name: sent_followups sent_followups_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sent_followups
    ADD CONSTRAINT sent_followups_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: sent_followups sent_followups_contact_id_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sent_followups
    ADD CONSTRAINT sent_followups_contact_id_company_id_fkey FOREIGN KEY (contact_id, company_id) REFERENCES public.contacts(contact_id, company_id);


--
-- Name: sent_followups sent_followups_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sent_followups
    ADD CONSTRAINT sent_followups_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.followup_templates(template_id);


--
-- Name: sessions sessions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id);


--
-- Name: settings settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: threads threads_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: threads threads_contact_id_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_contact_id_company_id_fkey FOREIGN KEY (contact_id, company_id) REFERENCES public.contacts(contact_id, company_id);


--
-- Name: usage_logs usage_logs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: users users_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

