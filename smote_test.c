#include<sys/types.h>
#include<sys/socket.h>
#include<stdio.h>
#include<stdlib.h>
#include<netdb.h>
#include<string.h>
#include<arpa/inet.h>
#include<pthread.h>
#include<unistd.h>

void *handle_tcp_conn(void *fdptr) {

    int newfd = *((int *)fdptr);
    while (1) {

        char buf[3000] = { '\0' };
        int rbytes = recv(newfd, buf, sizeof(buf), 0);

        if (rbytes == 0) {
            int close_res = close(newfd);
            return NULL;
        }

        printf("Sending %s back\n", buf);
        send(newfd, buf, rbytes, 0);
    }
}

void chat_server(long port) {

    struct addrinfo hints = {
        .ai_family = AF_UNSPEC,
        .ai_socktype = SOCK_STREAM,
        .ai_flags = AI_PASSIVE
    }, *res;

    char str_port[8];
    sprintf(str_port, "%ld", port);

    // HANDLE ERROR!
    getaddrinfo(NULL, str_port, &hints, &res);

    int sockfd;
    // Bind to the first possible address
    for (struct addrinfo *p = res; p != NULL; p = p->ai_next) {
        //sockfd = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
        sockfd = socket(p->ai_family, p->ai_socktype, p->ai_protocol);
        if (sockfd == -1) {
            printf("Could not socket!\n");
            continue;
        }

        int b = bind(sockfd, p->ai_addr, p->ai_addrlen);

        if (b == -1) {
            printf("bind error");
            continue;
        }
        break;
    }

    listen(sockfd, 3);
    freeaddrinfo(res); // - maybe after understanding storage struct

    while(1) {
        struct sockaddr_storage peer;
        socklen_t s = sizeof(peer);
        int newfd = accept(sockfd, (struct sockaddr *)&peer, &s);
        pthread_t tid;
        pthread_create(&tid, NULL, handle_tcp_conn, (void *)&newfd);
    }

    close(sockfd);
}

int main() {
    chat_server(2179);
    return 0;
}
