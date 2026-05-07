## requirements:


- JWT authentication for all services.
- Import single or multiple transactions from CSV file.
- Export transactions to CSV file.
- Send email notifications to users when their transactions are exported or on error.

deployment on azure serverless function:
- auth (serverless function) - jwt with better-auth
- import (serverless function) - 
- export (serverless function) - 
- db service (durable functions) (multi function, generate file from db, import to db from file) 
- email (serverless function) using resend



user -> api management(api gateway)
      
action:      
        -> auth service
        <- status
        
user    -> import(json) -> service bus -> db service -> db
        <- response

user    -> import(file) -> service bus -> db service -> blob storage -> db service -> db
        <- response

user    -> export -> service bus -> db service -> email
        <- response

test:
- local docker-compose and mimic service bus, db, storage, api gateway
- create request to test api with curl and json, csv files

right now the service is full node js/ts.