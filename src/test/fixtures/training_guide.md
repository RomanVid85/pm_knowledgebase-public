# Sample Training Guide

This is a synthetic training guide used by the parser test suite. It exercises
the markdown parser's section detection without including any real vendor
content.

## Lead Capture Workflow

Sales reps capture leads from inbound calls, walk-ins, and web form
submissions. Every lead must be associated with a contact record before it
can move to the qualification stage. The CRM enforces this with a validation
error if the contact field is empty.

When a lead arrives from a web form, the system automatically creates the
contact record if no match is found by email. Manual entry follows the same
flow but lets the rep override the email match in cases of typos.

## Appointment Scheduling

Once a lead is qualified, the rep schedules an appointment. Appointments can
be sales appointments (test drives, walk-ins) or service appointments.
Service appointments require selecting a service advisor in addition to the
lead's primary sales contact.

A reminder is sent 24 hours before the appointment via the customer's
preferred channel — text, email, or call — provided the customer has opted
in for that channel.

## Reporting

The reporting dashboard surfaces three core metrics: leads per source,
appointment show rate, and time-to-close. Each metric is available at the
rep, manager, and organization levels with filterable date ranges.
